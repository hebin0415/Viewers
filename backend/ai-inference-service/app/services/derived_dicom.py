from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import highdicom as hd
import numpy as np
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.sr.codedict import codes
from pydicom.uid import BasicTextSRStorage, ExplicitVRLittleEndian, generate_uid

from app.core.settings import settings
from app.schemas.api import InferencePayload, InferenceRequest
from app.services.source_series import load_source_series


def _code_dataset(code_value: str, coding_scheme: str, meaning: str) -> Dataset:
    dataset = Dataset()
    dataset.CodeValue = code_value
    dataset.CodingSchemeDesignator = coding_scheme
    dataset.CodeMeaning = meaning
    return dataset


def _series_metadata(dataset: FileDataset, *, description: str, modality: str) -> tuple[str, str, str]:
    return (
        getattr(dataset, 'StudyInstanceUID', generate_uid()),
        generate_uid(),
        description or f'AI Derived {modality}',
    )


def _resolve_segmentation_slice_index(slice_index: int | None, frame_count: int) -> int:
    if frame_count <= 1:
        return 0

    return min(max(slice_index or 0, 0), frame_count - 1)


def _rasterize_segmentation(payload: InferencePayload, source_images: list[FileDataset]) -> np.ndarray:
    segmentation = payload.visualizations.segmentation if payload.visualizations else None
    if segmentation is None:
        raise RuntimeError('Derived SEG generation requires a segmentation visualization payload')

    rows = int(getattr(source_images[0], 'Rows', 256))
    columns = int(getattr(source_images[0], 'Columns', 256))
    # highdicom requires one mask frame per referenced source plane.
    frame_count = max(len(source_images), 1)
    mask = np.zeros((frame_count, rows, columns), dtype=np.uint8)

    slice_index = _resolve_segmentation_slice_index(segmentation.sliceIndex, frame_count)
    x_start = max(0, int(segmentation.x * columns))
    y_start = max(0, int(segmentation.y * rows))
    x_end = min(columns, max(x_start + 1, int((segmentation.x + segmentation.width) * columns)))
    y_end = min(rows, max(y_start + 1, int((segmentation.y + segmentation.height) * rows)))
    mask[slice_index, y_start:y_end, x_start:x_end] = segmentation.segmentIndex
    return mask.astype(bool)


def create_seg_dataset(
    *,
    inference_id: str,
    request: InferenceRequest,
    payload: InferencePayload,
    destination_dir: Path,
) -> Path:
    source_images = load_source_series(request, payload)
    segmentation = payload.visualizations.segmentation if payload.visualizations else None
    if segmentation is None:
        raise RuntimeError('SEG generation requested without segmentation content')

    algorithm_identification = hd.AlgorithmIdentificationSequence(
        name='OHIF AI Inference',
        family=codes.DCM.ArtificialIntelligence,
        version=settings.app_version,
    )
    segment_description = hd.seg.SegmentDescription(
        segment_number=1,
        segment_label=segmentation.label,
        segmented_property_category=codes.SCT.Tissue,
        segmented_property_type=codes.SCT.Lesion,
        algorithm_type=hd.seg.SegmentAlgorithmTypeValues.AUTOMATIC,
        algorithm_identification=algorithm_identification,
    )
    source_image = source_images[0]
    _study_uid, series_instance_uid, series_description = _series_metadata(
        source_image,
        description=payload.storage.derivedSeriesDescription or f'{segmentation.label} Derived SEG',
        modality='SEG',
    )
    segmentation_dataset = hd.seg.Segmentation(
        source_images=source_images,
        pixel_array=_rasterize_segmentation(payload, source_images),
        segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
        segment_descriptions=[segment_description],
        series_instance_uid=series_instance_uid,
        sop_instance_uid=generate_uid(),
        series_number=9101,
        instance_number=1,
        manufacturer='OHIF',
        manufacturer_model_name='AI Inference Backend',
        software_versions=settings.app_version,
        device_serial_number='OHIF-AI',
        content_description=series_description,
        content_creator_name='OHIF^AI',
        transfer_syntax_uid=ExplicitVRLittleEndian,
    )

    destination_dir.mkdir(parents=True, exist_ok=True)
    output_path = destination_dir / f'{inference_id}.seg.dcm'
    segmentation_dataset.save_as(str(output_path))
    return output_path


def create_sr_dataset(
    *,
    inference_id: str,
    request: InferenceRequest,
    payload: InferencePayload,
    destination_dir: Path,
) -> Path:
    source_images = load_source_series(request, payload)
    source_image = source_images[0]
    study_instance_uid, series_instance_uid, series_description = _series_metadata(
        source_image,
        description=payload.storage.derivedSeriesDescription or f'{payload.summary} Derived SR',
        modality='SR',
    )

    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = BasicTextSRStorage
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    destination_dir.mkdir(parents=True, exist_ok=True)
    output_path = destination_dir / f'{inference_id}.sr.dcm'
    dataset = FileDataset(str(output_path), {}, file_meta=file_meta, preamble=b'\0' * 128)
    utc_now = datetime.now(UTC)
    dataset.SOPClassUID = BasicTextSRStorage
    dataset.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    dataset.StudyInstanceUID = study_instance_uid
    dataset.SeriesInstanceUID = series_instance_uid
    dataset.Modality = 'SR'
    dataset.SeriesDescription = series_description
    dataset.PatientName = getattr(source_image, 'PatientName', 'AI^Patient')
    dataset.PatientID = getattr(source_image, 'PatientID', 'AI-PATIENT')
    dataset.StudyDate = getattr(source_image, 'StudyDate', utc_now.strftime('%Y%m%d'))
    dataset.StudyTime = getattr(source_image, 'StudyTime', utc_now.strftime('%H%M%S'))
    dataset.ContentDate = utc_now.strftime('%Y%m%d')
    dataset.ContentTime = utc_now.strftime('%H%M%S')
    dataset.SeriesNumber = 9102
    dataset.InstanceNumber = 1
    dataset.CompletionFlag = 'COMPLETE'
    dataset.VerificationFlag = 'UNVERIFIED'
    dataset.ValueType = 'CONTAINER'
    dataset.ContinuityOfContent = 'SEPARATE'

    evidence_series = Dataset()
    evidence_series.SeriesInstanceUID = getattr(source_image, 'SeriesInstanceUID', request.seriesInstanceUID)
    evidence_series.ReferencedSOPSequence = Sequence([])
    for image in source_images:
        reference = Dataset()
        reference.ReferencedSOPClassUID = image.SOPClassUID
        reference.ReferencedSOPInstanceUID = image.SOPInstanceUID
        evidence_series.ReferencedSOPSequence.append(reference)

    evidence_study = Dataset()
    evidence_study.StudyInstanceUID = study_instance_uid
    evidence_study.ReferencedSeriesSequence = Sequence([evidence_series])
    dataset.CurrentRequestedProcedureEvidenceSequence = Sequence([evidence_study])

    root_container = Dataset()
    root_container.ValueType = 'CONTAINER'
    root_container.ContinuityOfContent = 'SEPARATE'
    root_container.ConceptNameCodeSequence = Sequence(
        [_code_dataset('18748-4', 'LN', 'Diagnostic imaging report')]
    )

    content_items: list[Dataset] = []

    summary_item = Dataset()
    summary_item.RelationshipType = 'CONTAINS'
    summary_item.ValueType = 'TEXT'
    summary_item.ConceptNameCodeSequence = Sequence([_code_dataset('121106', 'DCM', 'Finding')])
    summary_item.TextValue = payload.summary
    content_items.append(summary_item)

    detections = payload.visualizations.detections if payload.visualizations else []
    for detection in detections:
        item = Dataset()
        item.RelationshipType = 'CONTAINS'
        item.ValueType = 'TEXT'
        item.ConceptNameCodeSequence = Sequence([_code_dataset('121071', 'DCM', 'Finding site')])
        item.TextValue = (
            f'{detection.label} confidence={detection.confidence:.2f} '
            f'bbox=({detection.x:.3f},{detection.y:.3f},{detection.width:.3f},{detection.height:.3f}) '
            f'slice={detection.sliceIndex if detection.sliceIndex is not None else 0}'
        )
        content_items.append(item)

    if not detections:
        classification_item = Dataset()
        classification_item.RelationshipType = 'CONTAINS'
        classification_item.ValueType = 'TEXT'
        classification_item.ConceptNameCodeSequence = Sequence(
            [_code_dataset('111412', 'DCM', 'Narrative summary')]
        )
        classification_item.TextValue = payload.summary
        content_items.append(classification_item)

    root_container.ContentSequence = Sequence(content_items)
    dataset.ContentSequence = Sequence([root_container])
    dataset.save_as(str(output_path), enforce_file_format=True)
    return output_path
