from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import highdicom as hd
import numpy as np
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.sr.codedict import codes
from pydicom.uid import (
    BasicTextSRStorage,
    ExplicitVRLittleEndian,
    RTStructureSetStorage,
    generate_uid,
)

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
    normalized_description = (description or f'AI Derived {modality}')[:64].rstrip() or f'AI Derived {modality}'
    return (
        getattr(dataset, 'StudyInstanceUID', generate_uid()),
        generate_uid(),
        normalized_description,
    )


def _resolve_segmentation_slice_index(slice_index: int | None, frame_count: int) -> int:
    if frame_count <= 1:
        return 0

    return min(max(slice_index or 0, 0), frame_count - 1)


def _resolve_detection_slice_index(slice_index: int | None, frame_count: int) -> int:
    return _resolve_segmentation_slice_index(slice_index, frame_count)


def _get_pixel_spacing(source_image: FileDataset) -> tuple[float, float]:
    pixel_spacing = getattr(source_image, 'PixelSpacing', [1.0, 1.0])
    row_spacing = float(pixel_spacing[0]) if len(pixel_spacing) > 0 else 1.0
    column_spacing = float(pixel_spacing[1]) if len(pixel_spacing) > 1 else row_spacing
    return row_spacing, column_spacing


def _get_image_orientation(source_image: FileDataset) -> tuple[np.ndarray, np.ndarray]:
    orientation = getattr(source_image, 'ImageOrientationPatient', [1.0, 0.0, 0.0, 0.0, 1.0, 0.0])
    row_direction = np.asarray([float(value) for value in orientation[:3]], dtype=float)
    column_direction = np.asarray([float(value) for value in orientation[3:6]], dtype=float)
    return row_direction, column_direction


def _get_image_position(source_image: FileDataset) -> np.ndarray:
    image_position = getattr(source_image, 'ImagePositionPatient', [0.0, 0.0, 0.0])
    return np.asarray([float(value) for value in image_position[:3]], dtype=float)


def _pixel_to_patient_coordinate(source_image: FileDataset, x_pixel: float, y_pixel: float) -> list[float]:
    row_spacing, column_spacing = _get_pixel_spacing(source_image)
    row_direction, column_direction = _get_image_orientation(source_image)
    image_position = _get_image_position(source_image)
    patient_coordinate = (
        image_position
        + (x_pixel * column_spacing * row_direction)
        + (y_pixel * row_spacing * column_direction)
    )
    return [float(value) for value in patient_coordinate]


def _build_rtstruct_contour_data(
    detection,
    source_image: FileDataset,
) -> list[float]:
    rows = int(getattr(source_image, 'Rows', 256))
    columns = int(getattr(source_image, 'Columns', 256))

    x_start = max(0.0, detection.x * columns)
    y_start = max(0.0, detection.y * rows)
    x_end = min(float(columns), max(x_start + 1.0, (detection.x + detection.width) * columns))
    y_end = min(float(rows), max(y_start + 1.0, (detection.y + detection.height) * rows))

    contour_points = [
        _pixel_to_patient_coordinate(source_image, x_start, y_start),
        _pixel_to_patient_coordinate(source_image, x_end, y_start),
        _pixel_to_patient_coordinate(source_image, x_end, y_end),
        _pixel_to_patient_coordinate(source_image, x_start, y_end),
        _pixel_to_patient_coordinate(source_image, x_start, y_start),
    ]
    return [value for point in contour_points for value in point]


def _build_rtstruct_reference_sequence(source_images: list[FileDataset], study_instance_uid: str) -> Sequence:
    referenced_images = Sequence([])
    for image in source_images:
        reference = Dataset()
        reference.ReferencedSOPClassUID = image.SOPClassUID
        reference.ReferencedSOPInstanceUID = image.SOPInstanceUID
        referenced_images.append(reference)

    referenced_series = Dataset()
    referenced_series.SeriesInstanceUID = getattr(source_images[0], 'SeriesInstanceUID', generate_uid())
    referenced_series.ContourImageSequence = referenced_images

    referenced_study = Dataset()
    referenced_study.ReferencedSOPClassUID = '1.2.840.10008.3.1.2.3.2'
    referenced_study.ReferencedSOPInstanceUID = study_instance_uid
    referenced_study.RTReferencedSeriesSequence = Sequence([referenced_series])

    referenced_frame_of_reference = Dataset()
    referenced_frame_of_reference.FrameOfReferenceUID = getattr(
        source_images[0],
        'FrameOfReferenceUID',
        generate_uid(),
    )
    referenced_frame_of_reference.RTReferencedStudySequence = Sequence([referenced_study])

    return Sequence([referenced_frame_of_reference])


def create_rtstruct_dataset(
    *,
    inference_id: str,
    request: InferenceRequest,
    payload: InferencePayload,
    destination_dir: Path,
) -> Path:
    source_images = load_source_series(request, payload)
    detections = payload.visualizations.detections if payload.visualizations else []

    source_image = source_images[0]
    study_instance_uid, series_instance_uid, series_description = _series_metadata(
        source_image,
        description=payload.storage.derivedSeriesDescription or f'{payload.summary} Derived RTSTRUCT',
        modality='RTSTRUCT',
    )

    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = RTStructureSetStorage
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    destination_dir.mkdir(parents=True, exist_ok=True)
    output_path = destination_dir / f'{inference_id}.rtstruct.dcm'
    dataset = FileDataset(str(output_path), {}, file_meta=file_meta, preamble=b'\0' * 128)
    utc_now = datetime.now(UTC)
    dataset.SOPClassUID = RTStructureSetStorage
    dataset.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    dataset.StudyInstanceUID = study_instance_uid
    dataset.SeriesInstanceUID = series_instance_uid
    dataset.Modality = 'RTSTRUCT'
    dataset.SeriesDescription = series_description
    dataset.StructureSetLabel = 'AI_RTSTRUCT'
    dataset.StructureSetName = series_description[:64]
    dataset.StructureSetDate = utc_now.strftime('%Y%m%d')
    dataset.StructureSetTime = utc_now.strftime('%H%M%S')
    dataset.PatientName = getattr(source_image, 'PatientName', 'AI^Patient')
    dataset.PatientID = getattr(source_image, 'PatientID', 'AI-PATIENT')
    dataset.StudyDate = getattr(source_image, 'StudyDate', utc_now.strftime('%Y%m%d'))
    dataset.StudyTime = getattr(source_image, 'StudyTime', utc_now.strftime('%H%M%S'))
    dataset.SeriesNumber = 9103
    dataset.InstanceNumber = 1
    dataset.Manufacturer = 'OHIF'
    dataset.ManufacturerModelName = 'AI Inference Backend'
    dataset.SoftwareVersions = settings.app_version
    dataset.ReferencedFrameOfReferenceSequence = _build_rtstruct_reference_sequence(
        source_images,
        study_instance_uid,
    )

    structure_set_roi_sequence = Sequence([])
    roi_contour_sequence = Sequence([])
    rt_roi_observations_sequence = Sequence([])
    contour_colors = ([255, 64, 64], [64, 200, 255], [255, 196, 64], [128, 255, 128])

    for index, detection in enumerate(detections, start=1):
        slice_index = _resolve_detection_slice_index(detection.sliceIndex, len(source_images))
        contour_source_image = source_images[slice_index]

        structure_set_roi = Dataset()
        structure_set_roi.ROINumber = index
        structure_set_roi.ReferencedFrameOfReferenceUID = getattr(
            contour_source_image,
            'FrameOfReferenceUID',
            getattr(source_image, 'FrameOfReferenceUID', generate_uid()),
        )
        structure_set_roi.ROIName = detection.label[:64] or f'Detection {index}'
        structure_set_roi.ROIGenerationAlgorithm = 'AUTOMATIC'
        structure_set_roi_sequence.append(structure_set_roi)

        contour_image = Dataset()
        contour_image.ReferencedSOPClassUID = contour_source_image.SOPClassUID
        contour_image.ReferencedSOPInstanceUID = contour_source_image.SOPInstanceUID

        contour = Dataset()
        contour.ContourImageSequence = Sequence([contour_image])
        contour.ContourGeometricType = 'CLOSED_PLANAR'
        contour.NumberOfContourPoints = 5
        contour.ContourData = _build_rtstruct_contour_data(detection, contour_source_image)

        roi_contour = Dataset()
        roi_contour.ReferencedROINumber = index
        roi_contour.ROIDisplayColor = contour_colors[(index - 1) % len(contour_colors)]
        roi_contour.ContourSequence = Sequence([contour])
        roi_contour_sequence.append(roi_contour)

        roi_observation = Dataset()
        roi_observation.ObservationNumber = index
        roi_observation.ReferencedROINumber = index
        roi_observation.RTROIInterpretedType = 'ORGAN'
        roi_observation.ROIObservationLabel = f'AIDET-{index:03d}'
        roi_observation.ROIInterpreter = 'OHIF^AI'
        rt_roi_observations_sequence.append(roi_observation)

    dataset.StructureSetROISequence = structure_set_roi_sequence
    dataset.ROIContourSequence = roi_contour_sequence
    dataset.RTROIObservationsSequence = rt_roi_observations_sequence
    dataset.save_as(str(output_path), enforce_file_format=True)
    return output_path


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
    dataset.ConceptNameCodeSequence = Sequence(
        [_code_dataset('126000', 'DCM', 'Imaging Measurement Report')]
    )

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

    dataset.ContentSequence = Sequence(content_items)
    dataset.save_as(str(output_path), enforce_file_format=True)
    return output_path
