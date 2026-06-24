import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydicom import dcmread

from app.core.settings import settings
from app.main import app


client = TestClient(app)


@pytest.fixture(autouse=True)
def configure_external_runners(monkeypatch: pytest.MonkeyPatch):
    fixture_runner = Path(__file__).parent / 'fixtures' / 'external_model_runner.py'
    runners_dir = Path(__file__).resolve().parents[1] / 'runners'
    raw_command = json.dumps([sys.executable, str(fixture_runner)])

    monkeypatch.delenv('AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL', raising=False)
    monkeypatch.delenv('AI_INFERENCE_DICOMWEB_HEADERS_JSON', raising=False)
    monkeypatch.delenv('AI_INFERENCE_DICOMWEB_STOW_URL', raising=False)

    monkeypatch.setenv(
        'AI_INFERENCE_NNUNET_COMMAND',
        json.dumps([sys.executable, str(runners_dir / 'nnunet_wrapper.py')]),
    )
    monkeypatch.setenv(
        'AI_INFERENCE_YOLO_COMMAND',
        json.dumps([sys.executable, str(runners_dir / 'yolo_wrapper.py')]),
    )
    monkeypatch.setenv(
        'AI_INFERENCE_MONAI_COMMAND',
        json.dumps([sys.executable, str(runners_dir / 'monai_wrapper.py')]),
    )

    monkeypatch.setenv('AI_INFERENCE_NNUNET_WRAPPER_COMMAND', raw_command)
    monkeypatch.setenv('AI_INFERENCE_YOLO_WRAPPER_COMMAND', raw_command)
    monkeypatch.setenv('AI_INFERENCE_MONAI_WRAPPER_COMMAND', raw_command)

    original_values = {
        'dicomweb_stow_url': settings.dicomweb_stow_url,
        'dicomweb_retrieve_base_url': settings.dicomweb_retrieve_base_url,
        'dicomweb_headers': settings.dicomweb_headers,
    }

    object.__setattr__(settings, 'dicomweb_stow_url', None)
    object.__setattr__(settings, 'dicomweb_retrieve_base_url', None)
    object.__setattr__(settings, 'dicomweb_headers', {})

    yield

    for key, value in original_values.items():
        object.__setattr__(settings, key, value)


def test_model_listing_exposes_supported_model_families() -> None:
    response = client.get("/models")

    assert response.status_code == 200
    payload = response.json()
    assert [item["name"] for item in payload] == ["nnunet", "yolo", "monai"]
    assert [item["integrationMode"] for item in payload] == [
        "external-runner",
        "external-runner",
        "external-runner",
    ]
    assert [item["configured"] for item in payload] == [True, True, True]


def test_inference_request_creates_result_and_job_records() -> None:
    response = client.post(
        "/infer",
        json={
            "modelName": "nnunet",
            "taskType": "segmentation",
            "studyInstanceUID": "1.2.3",
            "seriesInstanceUID": "4.5.6",
            "options": {
                "async": True,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "queued"
    assert payload["modelName"] == "nnunet"

    job_response = client.get(f"/jobs/{payload['jobId']}")
    assert job_response.status_code == 200
    assert job_response.json()["status"] == "completed"
    assert job_response.json()["resultReady"] is True

    result_response = client.get(f"/results/{payload['inferenceId']}")
    assert result_response.status_code == 200
    assert (
        result_response.json()["payload"]["summary"]
        == "nnU-Net external runner completed segmentation"
    )
    assert result_response.json()["payload"]["visualizations"]["segmentation"]["label"] == "nnU-Net lesion"
    assert result_response.json()["payload"]["storage"]["mode"] == "derived-series"
    assert result_response.json()["payload"]["storage"]["derivedSeriesInstanceUID"]
    artifact_uri = result_response.json()["payload"]["artifactUri"]
    artifact_path = Path(artifact_uri.replace("file:///", ""))
    dataset = dcmread(str(artifact_path), stop_before_pixels=True, force=True)
    assert dataset.SOPClassUID == '1.2.840.10008.5.1.4.1.1.66.4'


def test_detection_endpoint_can_run_synchronously() -> None:
    response = client.post(
        "/infer/detection",
        json={
            "modelName": "yolo",
            "taskType": "segmentation",
            "studyInstanceUID": "1.2.840",
            "seriesInstanceUID": "2.16.840",
            "options": {
                "async": False,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["taskType"] == "detection"
    assert payload["resultFormat"] == "dicom-sr"
    assert payload["payload"]["summary"] == "YOLO external runner completed detection"
    assert len(payload["payload"]["visualizations"]["detections"]) == 2
    assert payload["payload"]["storage"]["mode"] == "derived-series"
    assert payload["payload"]["storage"]["derivedSeriesInstanceUID"]
    artifact_path = Path(payload["payload"]["artifactUri"].replace("file:///", ""))
    dataset = dcmread(str(artifact_path), stop_before_pixels=True, force=True)
    assert dataset.SOPClassUID == '1.2.840.10008.5.1.4.1.1.88.11'


def test_monai_classification_can_run_synchronously() -> None:
    response = client.post(
        "/infer",
        json={
            "modelName": "monai",
            "taskType": "classification",
            "studyInstanceUID": "9.8.7",
            "seriesInstanceUID": "6.5.4",
            "options": {
                "async": False,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["modelName"] == "monai"
    assert payload["taskType"] == "classification"
    assert payload["payload"]["storage"]["mode"] == "derived-series"
    assert payload["payload"]["storage"]["derivedSeriesInstanceUID"]
    assert payload["payload"]["visualizations"]["segmentation"] is None
    assert payload["payload"]["visualizations"]["detections"] == []
    artifact_path = Path(payload["payload"]["artifactUri"].replace("file:///", ""))
    dataset = dcmread(str(artifact_path), stop_before_pixels=True, force=True)
    assert dataset.SOPClassUID == '1.2.840.10008.5.1.4.1.1.88.11'


def test_segmentation_task_returns_derived_series_metadata_when_runner_provides_it() -> None:
    response = client.post(
        "/infer/segmentation",
        json={
            "modelName": "monai",
            "taskType": "detection",
            "studyInstanceUID": "7.7.7",
            "seriesInstanceUID": "8.8.8",
            "options": {
                "async": False,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["taskType"] == "segmentation"
    assert payload["payload"]["storage"]["mode"] == "derived-series"
    assert payload["payload"]["storage"]["derivedSeriesInstanceUID"]
