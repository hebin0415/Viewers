from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import types


def _load_monai_engine_module():
    sys.modules.setdefault('nibabel', types.SimpleNamespace(load=lambda *_args, **_kwargs: None))
    sys.modules.setdefault(
        'ohif_runtime_common',
        types.SimpleNamespace(
            compute_mask_visualization=lambda *args, **kwargs: None,
            dicom_series_to_nifti=lambda *args, **kwargs: None,
            fetch_series_to_directory=lambda *args, **kwargs: [],
            find_first_nifti=lambda *args, **kwargs: None,
            load_request=lambda *args, **kwargs: {},
            write_response=lambda *args, **kwargs: None,
        ),
    )

    module_path = (
        Path(__file__).resolve().parents[1] / 'runtime-images' / 'monai' / 'infer-engine.py'
    )
    spec = importlib.util.spec_from_file_location('monai_infer_engine', module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_ensure_bundle_device_compatibility_adds_map_location_to_checkpoint_loader(tmp_path: Path) -> None:
    module = _load_monai_engine_module()
    bundle_root = tmp_path / 'bundle'
    config_dir = bundle_root / 'configs'
    config_dir.mkdir(parents=True, exist_ok=True)
    inference_config = config_dir / 'inference.json'
    inference_config.write_text(
        json.dumps(
            {
                'device': "$torch.device('cuda:0' if torch.cuda.is_available() else 'cpu')",
                'checkpointloader': {
                    '_target_': 'CheckpointLoader',
                    'load_path': 'model.pt',
                    'load_dict': {'model': '@network'},
                },
            },
            indent=2,
        ),
        encoding='utf-8',
    )

    module.ensure_bundle_device_compatibility(bundle_root)

    patched = json.loads(inference_config.read_text(encoding='utf-8'))
    assert patched['checkpointloader']['map_location'] == '@device'


def test_ensure_bundle_device_compatibility_is_idempotent_for_existing_map_location(tmp_path: Path) -> None:
    module = _load_monai_engine_module()
    bundle_root = tmp_path / 'bundle'
    config_dir = bundle_root / 'configs'
    config_dir.mkdir(parents=True, exist_ok=True)
    inference_config = config_dir / 'inference.json'
    inference_config.write_text(
        json.dumps(
            {
                'checkpointloader': {
                    '_target_': 'CheckpointLoader',
                    'map_location': '@device',
                    'load_path': 'model.pt',
                }
            },
            indent=2,
        ) + '\n',
        encoding='utf-8',
    )
    before = inference_config.read_text(encoding='utf-8')

    module.ensure_bundle_device_compatibility(bundle_root)

    assert inference_config.read_text(encoding='utf-8') == before
