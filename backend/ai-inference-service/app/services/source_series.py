from __future__ import annotations

from email.parser import BytesParser
from email.policy import default
from io import BytesIO

import httpx
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid

from app.core.settings import settings
from app.schemas.api import InferenceRequest, InferencePayload


def _build_dicomweb_series_url(request: InferenceRequest) -> str | None:
    if not request.studyInstanceUID or not request.seriesInstanceUID:
        return None

    base_url = settings.dicomweb_retrieve_base_url
    if not base_url and settings.dicomweb_stow_url:
        base_url = settings.dicomweb_stow_url.removesuffix('/studies')

    if not base_url:
        return None

    return (
        f"{base_url.rstrip('/')}/studies/{request.studyInstanceUID}/series/{request.seriesInstanceUID}"
    )


def _parse_retrieved_datasets(content_type: str, content: bytes) -> list[FileDataset]:
    if content_type.startswith('application/dicom'):
        return [pydicom.dcmread(BytesIO(content), force=True)]

    message = BytesParser(policy=default).parsebytes(
        f'Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n'.encode('utf-8') + content
    )
    datasets: list[FileDataset] = []
    for part in message.iter_parts():
        if part.get_content_type() != 'application/dicom':
            continue

        datasets.append(pydicom.dcmread(BytesIO(part.get_payload(decode=True)), force=True))

    return datasets


def _slice_count_hint(payload: InferencePayload) -> int:
    segmentation = payload.visualizations.segmentation if payload.visualizations else None
    detections = payload.visualizations.detections if payload.visualizations else []
    candidate_indexes = [0]
    if segmentation and segmentation.sliceIndex is not None:
        candidate_indexes.append(segmentation.sliceIndex)
    candidate_indexes.extend(
        detection.sliceIndex for detection in detections if detection.sliceIndex is not None
    )
    return max(candidate_indexes) + 1


def _build_synthetic_source_images(
    request: InferenceRequest,
    *,
    number_of_instances: int,
) -> list[FileDataset]:
    study_instance_uid = request.studyInstanceUID or generate_uid()
    series_instance_uid = request.seriesInstanceUID or generate_uid()
    frame_of_reference_uid = generate_uid()
    images: list[FileDataset] = []

    for instance_number in range(1, number_of_instances + 1):
        file_meta = FileMetaDataset()
        file_meta.MediaStorageSOPClassUID = CTImageStorage
        file_meta.MediaStorageSOPInstanceUID = generate_uid()
        file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

        dataset = FileDataset('', {}, file_meta=file_meta, preamble=b'\0' * 128)
        dataset.SOPClassUID = CTImageStorage
        dataset.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
        dataset.StudyInstanceUID = study_instance_uid
        dataset.SeriesInstanceUID = series_instance_uid
        dataset.Modality = 'CT'
        dataset.PatientName = 'AI^Synthetic'
        dataset.PatientID = 'AI-SYNTHETIC'
        dataset.PatientBirthDate = '19700101'
        dataset.PatientSex = 'O'
        dataset.AccessionNumber = 'AI-ACCESSION'
        dataset.StudyID = 'AI-STUDY'
        dataset.ReferringPhysicianName = 'AI^Referrer'
        dataset.StudyDescription = 'Synthetic AI Study'
        dataset.SeriesDescription = 'Synthetic AI Source Series'
        dataset.StudyDate = '20260609'
        dataset.StudyTime = '120000'
        dataset.SeriesDate = '20260609'
        dataset.SeriesTime = '120000'
        dataset.AcquisitionDate = '20260609'
        dataset.AcquisitionTime = '120000'
        dataset.ContentTime = '120000'
        dataset.ContentDate = '20260609'
        dataset.FrameOfReferenceUID = frame_of_reference_uid
        dataset.SeriesNumber = 1
        dataset.InstanceNumber = instance_number
        dataset.Rows = 256
        dataset.Columns = 256
        dataset.PixelSpacing = [1.0, 1.0]
        dataset.SliceThickness = 1.0
        dataset.SpacingBetweenSlices = 1.0
        dataset.ImageOrientationPatient = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
        dataset.ImagePositionPatient = [0.0, 0.0, float(instance_number - 1)]
        dataset.PositionReferenceIndicator = ''
        dataset.SamplesPerPixel = 1
        dataset.PhotometricInterpretation = 'MONOCHROME2'
        dataset.BitsAllocated = 16
        dataset.BitsStored = 16
        dataset.HighBit = 15
        dataset.PixelRepresentation = 0
        dataset.RescaleIntercept = 0
        dataset.RescaleSlope = 1
        dataset.PixelData = (b'\0\0') * (dataset.Rows * dataset.Columns)
        images.append(dataset)

    return images


def load_source_series(request: InferenceRequest, payload: InferencePayload) -> list[FileDataset]:
    retrieve_url = _build_dicomweb_series_url(request)
    if retrieve_url:
        response = httpx.get(
            retrieve_url,
            headers={
                'Accept': 'multipart/related; type="application/dicom"',
                **settings.dicomweb_headers,
            },
            timeout=settings.dicomweb_timeout_seconds,
        )
        response.raise_for_status()

        datasets = _parse_retrieved_datasets(
            response.headers.get('content-type', 'application/dicom'),
            response.content,
        )
        if datasets:
            return sorted(datasets, key=lambda item: int(getattr(item, 'InstanceNumber', 0) or 0))

    return _build_synthetic_source_images(request, number_of_instances=_slice_count_hint(payload))
