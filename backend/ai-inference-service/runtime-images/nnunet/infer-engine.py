from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parents[1]
COMMON_DIR = CURRENT_DIR / 'common'
if str(COMMON_DIR) not in sys.path:
    sys.path.insert(0, str(COMMON_DIR))

from ohif_runtime_common import fetch_series_to_directory, load_request, normalize_device_for_totalsegmentator, write_response


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True)
    parser.add_argument('--response', required=True)
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--device', default='cpu')
    return parser.parse_args()


def ensure_weights(model_dir: Path) -> tuple[str, str, str]:
    weights_task = os.environ.get('AI_INFERENCE_NNUNET_WEIGHTS_TASK', 'total_fast').strip() or 'total_fast'
    task = os.environ.get('AI_INFERENCE_NNUNET_TASK', 'total').strip() or 'total'
    roi = os.environ.get('AI_INFERENCE_NNUNET_ROI', '').strip()
    home_dir = model_dir / 'totalsegmentator-home'
    home_dir.mkdir(parents=True, exist_ok=True)
    os.environ['TOTALSEG_HOME_DIR'] = str(home_dir)

    completed = subprocess.run(
        ['totalseg_download_weights', '-t', weights_task],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        error_text = completed.stderr.strip() or completed.stdout.strip() or 'unknown error'
        raise RuntimeError(f'TotalSegmentator weight download failed: {error_text}')

    return weights_task, task, roi


def main() -> int:
    args = parse_args()
    request = load_request(args.request)
    model_dir = Path(args.model_dir).resolve()
    model_dir.mkdir(parents=True, exist_ok=True)

    weights_task, task, roi = ensure_weights(model_dir)
    device = normalize_device_for_totalsegmentator(args.device)

    with tempfile.TemporaryDirectory(prefix='ohif-nnunet-') as temp_dir:
        temp_root = Path(temp_dir)
        dicom_dir = temp_root / 'source-dicom'
        fetch_series_to_directory(
            request.get('studyInstanceUID', ''),
            request.get('seriesInstanceUID', ''),
            dicom_dir,
        )

        source_instances = [path for path in dicom_dir.rglob('*') if path.is_file()]
        if len(source_instances) < 3:
            raise RuntimeError(
                'nnunet requires a volumetric source series with at least 3 instances. '
                f'Current series has {len(source_instances)} instance(s); localizer/scout series are not supported.'
            )

        output_dir = temp_root / 'totalsegmentator-output'
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            'TotalSegmentator',
            '-i',
            str(dicom_dir),
            '-o',
            str(output_dir),
            '--task',
            task,
            '--output_type',
            'dicom',
            '--device',
            device,
        ]
        if roi:
            command.extend(['--roi_subset', roi])
        if weights_task.endswith('fast'):
            command.append('--fast')

        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            error_text = completed.stderr.strip() or completed.stdout.strip() or 'unknown error'
            raise RuntimeError(f'TotalSegmentator inference failed: {error_text}')

        output_files = sorted(str(path) for path in output_dir.rglob('*.dcm') if path.is_file())
        if not output_files:
            raise RuntimeError('TotalSegmentator did not emit any DICOM output files.')

        staged_output_dir = Path(args.response).resolve().parent / 'dicom-artifacts'
        staged_output_dir.mkdir(parents=True, exist_ok=True)
        staged_output_files: list[str] = []
        for source_path_str in output_files:
            source_path = Path(source_path_str)
            destination_path = staged_output_dir / source_path.name
            shutil.copy2(source_path, destination_path)
            staged_output_files.append(str(destination_path))

        payload = {
            'summary': (
                f'TotalSegmentator generated a DICOM RT Struct for ROI {roi} using {weights_task}.'
                if roi
                else f'TotalSegmentator generated a DICOM RT Struct using {weights_task}.'
            ),
            'dicomFiles': staged_output_files,
            'metadata': {
                'framework': 'TotalSegmentator',
                'weightsTask': weights_task,
                'roiSubset': roi or None,
                'device': device,
            },
        }
        write_response(args.response, payload)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
