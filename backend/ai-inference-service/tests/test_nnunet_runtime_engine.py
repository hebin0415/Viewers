from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types

import numpy as np


def _load_nnunet_engine_module():
    sys.modules.setdefault('nibabel', types.SimpleNamespace(load=lambda *_args, **_kwargs: None))
    sys.modules.setdefault(
        'ohif_runtime_common',
        types.SimpleNamespace(
            compute_mask_visualization=lambda *args, **kwargs: None,
            dicom_series_to_nifti=lambda *args, **kwargs: None,
            fetch_series_to_directory=lambda *args, **kwargs: None,
            find_first_nifti=lambda *args, **kwargs: None,
            load_request=lambda *args, **kwargs: {},
            load_sorted_datasets=lambda *args, **kwargs: [],
            normalize_device_for_totalsegmentator=lambda device: device,
            write_response=lambda *args, **kwargs: None,
        ),
    )

    module_path = (
        Path(__file__).resolve().parents[1] / 'runtime-images' / 'nnunet' / 'infer-engine.py'
    )
    spec = importlib.util.spec_from_file_location('nnunet_infer_engine', module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_ensure_weights_skips_download_once_marker_exists(monkeypatch, tmp_path: Path) -> None:
    module = _load_nnunet_engine_module()

    calls: list[list[str]] = []

    class CompletedProcess:
        returncode = 0
        stdout = 'ok'
        stderr = ''

    def fake_run(command, *_args, **_kwargs):
        calls.append(command)
        return CompletedProcess()

    monkeypatch.setattr(module.subprocess, 'run', fake_run)
    monkeypatch.setenv('AI_INFERENCE_NNUNET_WEIGHTS_TASK', 'total_fast')

    model_dir = tmp_path / 'nnunet-models'

    assert module.ensure_weights(model_dir) == ('total_fast', 'total', '')
    assert calls == [['totalseg_download_weights', '-t', 'total_fast']]

    calls.clear()

    assert module.ensure_weights(model_dir) == ('total_fast', 'total', '')
    assert calls == []


def test_ensure_weights_adopts_prewarmed_home_dir_without_redownloading(
    monkeypatch, tmp_path: Path
) -> None:
    module = _load_nnunet_engine_module()

    def fake_run(*_args, **_kwargs):
        raise AssertionError('weight download should not run when weights are already present')

    monkeypatch.setattr(module.subprocess, 'run', fake_run)
    monkeypatch.setenv('AI_INFERENCE_NNUNET_WEIGHTS_TASK', 'total_fast')

    model_dir = tmp_path / 'nnunet-models'
    prewarmed_home = model_dir / 'totalsegmentator-home' / 'weights'
    prewarmed_home.mkdir(parents=True, exist_ok=True)
    (prewarmed_home / 'checkpoint.bin').write_bytes(b'cached')

    assert module.ensure_weights(model_dir) == ('total_fast', 'total', '')
    assert (model_dir / 'totalsegmentator-home' / '.weights-ready-total_fast').exists()


def test_normalize_mask_volume_moves_slice_axis_to_front() -> None:
    module = _load_nnunet_engine_module()

    mask = np.zeros((16, 16, 3), dtype=np.uint8)
    mask[4:8, 5:9, 1] = 1

    normalized = module.normalize_mask_volume(mask, frame_count=3)

    assert normalized.shape == (3, 16, 16)
    assert normalized.dtype == np.bool_
    assert normalized[1, 4:8, 5:9].all()
