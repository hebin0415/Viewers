from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import nibabel as nib

CURRENT_DIR = Path(__file__).resolve().parents[1]
COMMON_DIR = CURRENT_DIR / 'common'
if str(COMMON_DIR) not in sys.path:
    sys.path.insert(0, str(COMMON_DIR))

from ohif_runtime_common import (  # noqa: E402
    compute_mask_visualization,
    dicom_series_to_nifti,
    fetch_series_to_directory,
    find_first_nifti,
    load_request,
    write_response,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True)
    parser.add_argument('--response', required=True)
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--device', default='cpu')
    return parser.parse_args()


def ensure_bundle(model_dir: Path) -> Path:
    bundle_name = os.environ.get('AI_INFERENCE_MONAI_BUNDLE', 'spleen_ct_segmentation').strip() or 'spleen_ct_segmentation'
    bundle_root = model_dir / bundle_name
    if bundle_root.exists():
        return bundle_root

    completed = subprocess.run(
        [sys.executable, '-m', 'monai.bundle', 'download', bundle_name, '--bundle_dir', str(model_dir)],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        error_text = completed.stderr.strip() or completed.stdout.strip() or 'unknown error'
        raise RuntimeError(f'MONAI bundle download failed: {error_text}')

    if not bundle_root.exists():
        raise RuntimeError(f'MONAI bundle {bundle_name} was not created under {model_dir}.')

    return bundle_root


def main() -> int:
    args = parse_args()
    request = load_request(args.request)
    model_dir = Path(args.model_dir).resolve()
    model_dir.mkdir(parents=True, exist_ok=True)
    bundle_root = ensure_bundle(model_dir)

    with tempfile.TemporaryDirectory(prefix='ohif-monai-') as temp_dir:
        temp_root = Path(temp_dir)
        dicom_dir = temp_root / 'source-dicom'
        fetch_series_to_directory(
            request.get('studyInstanceUID', ''),
            request.get('seriesInstanceUID', ''),
            dicom_dir,
        )

        input_volume = dicom_series_to_nifti(dicom_dir, temp_root / 'input-volume.nii.gz')
        output_dir = temp_root / 'output'
        env = os.environ.copy()
        env['PYTHONPATH'] = os.pathsep.join(filter(None, [str(bundle_root), env.get('PYTHONPATH', '')]))
        command = [
            sys.executable,
            '-m',
            'monai.bundle',
            'run',
            '--meta_file',
            str(bundle_root / 'configs' / 'metadata.json'),
            '--config_file',
            str(bundle_root / 'configs' / 'inference.json'),
            '--bundle_root',
            str(bundle_root),
            '--datalist',
            f'["{input_volume.as_posix()}"]',
            '--output_dir',
            str(output_dir),
        ]
        completed = subprocess.run(command, env=env, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            error_text = completed.stderr.strip() or completed.stdout.strip() or 'unknown error'
            raise RuntimeError(f'MONAI bundle inference failed: {error_text}')

        output_mask_path = find_first_nifti(output_dir)
        output_mask = nib.load(output_mask_path).get_fdata()
        visualization = compute_mask_visualization(output_mask)
        if visualization is None:
            raise RuntimeError('MONAI bundle produced an empty segmentation mask.')

        payload = {
            'summary': 'MONAI bundle spleen_ct_segmentation produced a segmentation mask.',
            'segmentation': {
                'label': 'spleen',
                'segmentIndex': 1,
                **visualization,
            },
            'metadata': {
                'framework': 'MONAI Bundle',
                'bundleRoot': str(bundle_root),
            },
        }
        write_response(args.response, payload)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
