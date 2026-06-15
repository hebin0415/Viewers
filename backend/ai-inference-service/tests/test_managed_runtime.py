import json
import socket
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

import app.main as app_main
from app.core.settings import settings
from app.services.managed_runtime_manager import ManagedRuntimeManager


def _get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return int(sock.getsockname()[1])


@pytest.fixture(name='managed_runtime_api_client')
def _managed_runtime_api_client(monkeypatch: pytest.MonkeyPatch):
    fixture_runner = Path(__file__).parent / 'fixtures' / 'external_model_runner.py'
    runtime_command = json.dumps([sys.executable, str(fixture_runner)])
    runtime_gateway_root = Path(__file__).resolve().parents[1]

    def build_managed_command(family: str, port: int) -> str:
        return json.dumps(
            [
                sys.executable,
                '-m',
                'app.runtime_server',
                '--family',
                family,
                '--host',
                '127.0.0.1',
                '--port',
                str(port),
            ]
        )

    monkeypatch.delenv('AI_INFERENCE_NNUNET_COMMAND', raising=False)
    monkeypatch.delenv('AI_INFERENCE_YOLO_COMMAND', raising=False)
    monkeypatch.delenv('AI_INFERENCE_MONAI_COMMAND', raising=False)
    monkeypatch.delenv('AI_INFERENCE_NNUNET_WRAPPER_COMMAND', raising=False)
    monkeypatch.delenv('AI_INFERENCE_YOLO_WRAPPER_COMMAND', raising=False)
    monkeypatch.delenv('AI_INFERENCE_MONAI_WRAPPER_COMMAND', raising=False)
    monkeypatch.delenv('AI_INFERENCE_NNUNET_MANAGED_COMMAND', raising=False)
    monkeypatch.delenv('AI_INFERENCE_YOLO_MANAGED_COMMAND', raising=False)
    monkeypatch.delenv('AI_INFERENCE_MONAI_MANAGED_COMMAND', raising=False)
    monkeypatch.delenv('AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL', raising=False)
    monkeypatch.delenv('AI_INFERENCE_DICOMWEB_HEADERS_JSON', raising=False)
    monkeypatch.delenv('AI_INFERENCE_DICOMWEB_STOW_URL', raising=False)

    monkeypatch.setenv('AI_INFERENCE_NNUNET_RUNTIME_COMMAND', runtime_command)
    monkeypatch.setenv('AI_INFERENCE_YOLO_RUNTIME_COMMAND', runtime_command)
    monkeypatch.setenv('AI_INFERENCE_MONAI_RUNTIME_COMMAND', runtime_command)

    original_values = {
        'dicomweb_stow_url': settings.dicomweb_stow_url,
        'dicomweb_retrieve_base_url': settings.dicomweb_retrieve_base_url,
        'dicomweb_headers': settings.dicomweb_headers,
        'managed_runtimes_enabled': settings.managed_runtimes_enabled,
        'managed_runtime_host': settings.managed_runtime_host,
        'managed_runtime_startup_timeout_seconds': settings.managed_runtime_startup_timeout_seconds,
        'nnunet_runtime_port': settings.nnunet_runtime_port,
        'yolo_runtime_port': settings.yolo_runtime_port,
        'monai_runtime_port': settings.monai_runtime_port,
    }
    original_manager = app_main.managed_runtime_manager

    object.__setattr__(settings, 'dicomweb_stow_url', None)
    object.__setattr__(settings, 'dicomweb_retrieve_base_url', None)
    object.__setattr__(settings, 'dicomweb_headers', {})
    object.__setattr__(settings, 'managed_runtimes_enabled', True)
    object.__setattr__(settings, 'managed_runtime_host', '127.0.0.1')
    object.__setattr__(settings, 'managed_runtime_startup_timeout_seconds', 10.0)
    object.__setattr__(settings, 'nnunet_runtime_port', _get_free_port())
    object.__setattr__(settings, 'yolo_runtime_port', _get_free_port())
    object.__setattr__(settings, 'monai_runtime_port', _get_free_port())

    monkeypatch.chdir(runtime_gateway_root)
    monkeypatch.setenv(
        'AI_INFERENCE_NNUNET_MANAGED_COMMAND',
        build_managed_command('nnunet', settings.nnunet_runtime_port),
    )
    monkeypatch.setenv(
        'AI_INFERENCE_YOLO_MANAGED_COMMAND',
        build_managed_command('yolo', settings.yolo_runtime_port),
    )
    monkeypatch.setenv(
        'AI_INFERENCE_MONAI_MANAGED_COMMAND',
        build_managed_command('monai', settings.monai_runtime_port),
    )

    app_main.managed_runtime_manager = ManagedRuntimeManager()

    with TestClient(app_main.app) as client:
        yield client

    app_main.managed_runtime_manager = original_manager
    for key, value in original_values.items():
        object.__setattr__(settings, key, value)


def test_managed_runtime_startup_exposes_backend_and_runtime_health(
    managed_runtime_api_client: TestClient,
) -> None:
    response = managed_runtime_api_client.get('/health')

    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'ok'
    assert payload['availableModels'] == 3

    runtime_health = httpx.get(
        f'http://{settings.managed_runtime_host}:{settings.nnunet_runtime_port}/health',
        timeout=2.0,
    )
    assert runtime_health.status_code == 200
    assert runtime_health.json() == {
        'status': 'ok',
        'family': 'nnunet',
        'configured': True,
    }


def test_managed_runtime_model_listing_marks_all_families_configured(
    managed_runtime_api_client: TestClient,
) -> None:
    response = managed_runtime_api_client.get('/models')

    assert response.status_code == 200
    payload = response.json()
    assert [item['name'] for item in payload] == ['nnunet', 'yolo', 'monai']
    assert [item['configured'] for item in payload] == [True, True, True]
    assert all(item['configurationHint'] is None for item in payload)


def test_managed_runtime_infer_executes_real_command_path(
    managed_runtime_api_client: TestClient,
) -> None:
    response = managed_runtime_api_client.post(
        '/infer',
        json={
            'modelName': 'nnunet',
            'taskType': 'segmentation',
            'studyInstanceUID': '1.2.3',
            'seriesInstanceUID': '4.5.6',
            'options': {
                'async': False,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'completed'
    assert payload['modelName'] == 'nnunet'
    assert payload['payload']['summary'] == 'nnU-Net external runner completed segmentation'
    assert payload['payload']['storage']['mode'] == 'derived-series'
    assert payload['payload']['storage']['derivedSeriesInstanceUID']
