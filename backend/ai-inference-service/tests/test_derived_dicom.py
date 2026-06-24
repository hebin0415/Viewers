from pathlib import Path

import pydicom
import pytest
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid

from app.schemas.api import (
    DetectionVisualization,
    InferencePayload,
    InferenceRequest,
    InferenceVisualizations,
    ResultStorageInfo,
)
from app.services import derived_dicom


def _build_source_image() -> FileDataset:
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = CTImageStorage
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    dataset = FileDataset('source.dcm', {}, file_meta=file_meta, preamble=b'\0' * 128)
    dataset.SOPClassUID = CTImageStorage
    dataset.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    dataset.StudyInstanceUID = '1.2.840.113704.9.1000.16.0.20150317132625248'
    dataset.SeriesInstanceUID = generate_uid()
    dataset.PatientName = 'Test^Patient'
    dataset.PatientID = 'TEST-001'
    dataset.StudyDate = '20260622'
    dataset.StudyTime = '120000'
    dataset.FrameOfReferenceUID = generate_uid()
    dataset.Rows = 16
    dataset.Columns = 16
    dataset.PixelSpacing = [1.0, 1.0]
    dataset.ImageOrientationPatient = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    dataset.ImagePositionPatient = [0.0, 0.0, 0.0]
    return dataset


def test_create_sr_dataset_uses_top_level_document_container(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(derived_dicom, 'load_source_series', lambda request, payload: [_build_source_image()])

    output_path = derived_dicom.create_sr_dataset(
        inference_id='test-inference',
        request=InferenceRequest(
            modelName='yolo',
            taskType='detection',
            studyInstanceUID='1.2.840.113704.9.1000.16.0.20150317132625248',
            seriesInstanceUID='2.16.840.1',
        ),
        payload=InferencePayload(
            summary='YOLO found one candidate lesion',
            visualizations=InferenceVisualizations(
                detections=[
                    DetectionVisualization(
                        id='yolo-1',
                        label='Candidate lesion',
                        confidence=0.91,
                        x=0.2,
                        y=0.3,
                        width=0.1,
                        height=0.15,
                        sliceIndex=0,
                    )
                ]
            ),
            storage=ResultStorageInfo(mode='derived-series'),
        ),
        destination_dir=tmp_path,
    )

    dataset = pydicom.dcmread(str(output_path), stop_before_pixels=True, force=True)

    assert dataset.ValueType == 'CONTAINER'
    assert dataset.ConceptNameCodeSequence[0].CodeValue == '126000'
    assert isinstance(dataset.ContentSequence, Sequence)
    assert len(dataset.ContentSequence) == 2
    assert all(getattr(item, 'RelationshipType', None) == 'CONTAINS' for item in dataset.ContentSequence)
    assert all(getattr(item, 'ValueType', None) == 'TEXT' for item in dataset.ContentSequence)
    assert not hasattr(dataset.ContentSequence[0], 'ContentSequence')
    assert dataset.ContentSequence[1].ContentSequence[0].ValueType == 'IMAGE'
    reference = dataset.ContentSequence[1].ContentSequence[0].ReferencedSOPSequence[0]
    assert reference.ReferencedSOPInstanceUID == dataset.CurrentRequestedProcedureEvidenceSequence[0].ReferencedSeriesSequence[0].ReferencedSOPSequence[0].ReferencedSOPInstanceUID


def test_create_rtstruct_dataset_references_source_image_series(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    source_images = [_build_source_image(), _build_source_image()]
    source_images[1].SOPInstanceUID = generate_uid()
    source_images[1].InstanceNumber = 2
    source_images[1].ImagePositionPatient = [0.0, 0.0, 1.0]
    monkeypatch.setattr(derived_dicom, 'load_source_series', lambda request, payload: source_images)

    output_path = derived_dicom.create_rtstruct_dataset(
        inference_id='test-rtstruct',
        request=InferenceRequest(
            modelName='yolo',
            taskType='detection',
            studyInstanceUID='1.2.840.113704.9.1000.16.0.20150317132625248',
            seriesInstanceUID='2.16.840.1',
        ),
        payload=InferencePayload(
            summary='YOLO found two candidate lesions',
            visualizations=InferenceVisualizations(
                detections=[
                    DetectionVisualization(
                        id='yolo-1',
                        label='Candidate lesion',
                        confidence=0.91,
                        x=0.2,
                        y=0.3,
                        width=0.1,
                        height=0.15,
                        sliceIndex=0,
                    ),
                    DetectionVisualization(
                        id='yolo-2',
                        label='Secondary focus',
                        confidence=0.87,
                        x=0.45,
                        y=0.5,
                        width=0.12,
                        height=0.14,
                        sliceIndex=1,
                    ),
                ]
            ),
            storage=ResultStorageInfo(mode='derived-series'),
        ),
        destination_dir=tmp_path,
    )

    dataset = pydicom.dcmread(str(output_path), stop_before_pixels=True, force=True)

    assert dataset.SOPClassUID == '1.2.840.10008.5.1.4.1.1.481.3'
    assert dataset.Modality == 'RTSTRUCT'
    assert len(dataset.ReferencedFrameOfReferenceSequence) == 1
    referenced_series = (
        dataset.ReferencedFrameOfReferenceSequence[0]
        .RTReferencedStudySequence[0]
        .RTReferencedSeriesSequence[0]
    )
    assert len(referenced_series.ContourImageSequence) == 2
    assert len(dataset.StructureSetROISequence) == 2
    assert len(dataset.ROIContourSequence) == 2
    assert len(dataset.RTROIObservationsSequence) == 2
    assert dataset.ROIContourSequence[1].ContourSequence[0].ContourImageSequence[0].ReferencedSOPInstanceUID == source_images[1].SOPInstanceUID


def test_create_rtstruct_dataset_allows_zero_detections(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(derived_dicom, 'load_source_series', lambda request, payload: [_build_source_image()])

    output_path = derived_dicom.create_rtstruct_dataset(
        inference_id='test-empty-rtstruct',
        request=InferenceRequest(
            modelName='yolo',
            taskType='detection',
            studyInstanceUID='1.2.840.113704.9.1000.16.0.20150317132625248',
            seriesInstanceUID='2.16.840.1',
        ),
        payload=InferencePayload(
            summary='YOLO identified no candidate lesion above threshold',
            visualizations=InferenceVisualizations(detections=[]),
            storage=ResultStorageInfo(mode='derived-series'),
        ),
        destination_dir=tmp_path,
    )

    dataset = pydicom.dcmread(str(output_path), stop_before_pixels=True, force=True)

    assert dataset.SOPClassUID == '1.2.840.10008.5.1.4.1.1.481.3'
    assert len(getattr(dataset, 'StructureSetROISequence', [])) == 0
    assert len(getattr(dataset, 'ROIContourSequence', [])) == 0
    assert len(getattr(dataset, 'RTROIObservationsSequence', [])) == 0
