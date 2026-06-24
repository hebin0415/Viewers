from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import highdicom as hd
import nibabel as nib
import numpy as np
from pydicom.sr.codedict import codes
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

CURRENT_DIR = Path(__file__).resolve().parents[1]
COMMON_DIR = CURRENT_DIR / 'common'
if str(COMMON_DIR) not in sys.path:
    sys.path.insert(0, str(COMMON_DIR))

from ohif_runtime_common import (
    compute_mask_visualization,
    dicom_series_to_nifti,
    fetch_series_to_directory,
    find_first_nifti,
    load_request,
    load_sorted_datasets,
    normalize_device_for_totalsegmentator,
    write_response,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True)
    parser.add_argument('--response', required=True)
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--device', default='cpu')
    return parser.parse_args()


def _weights_marker_path(home_dir: Path, weights_task: str) -> Path:
    safe_task = re.sub(r'[^a-zA-Z0-9._-]+', '-', weights_task).strip('-') or 'default'
    return home_dir / f'.weights-ready-{safe_task}'


def _has_downloaded_weights(home_dir: Path) -> bool:
    for path in home_dir.rglob('*'):
        if path.is_file() and not path.name.startswith('.weights-ready-'):
            return True
    return False


def ensure_weights(model_dir: Path) -> tuple[str, str, str]:
    weights_task = os.environ.get('AI_INFERENCE_NNUNET_WEIGHTS_TASK', 'total_fast').strip() or 'total_fast'
    task = os.environ.get('AI_INFERENCE_NNUNET_TASK', 'total').strip() or 'total'
    roi = os.environ.get('AI_INFERENCE_NNUNET_ROI', '').strip()
    home_dir = model_dir / 'totalsegmentator-home'
    home_dir.mkdir(parents=True, exist_ok=True)
    os.environ['TOTALSEG_HOME_DIR'] = str(home_dir)

    ready_marker = _weights_marker_path(home_dir, weights_task)
    if ready_marker.exists():
        return weights_task, task, roi
    if _has_downloaded_weights(home_dir):
        ready_marker.write_text('ready\n', encoding='utf-8')
        return weights_task, task, roi

    completed = subprocess.run(
        ['totalseg_download_weights', '-t', weights_task],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        error_text = completed.stderr.strip() or completed.stdout.strip() or 'unknown error'
        raise RuntimeError(f'TotalSegmentator weight download failed: {error_text}')

    ready_marker.write_text('ready\n', encoding='utf-8')

    return weights_task, task, roi


def _segmentation_label(task: str, roi: str) -> str:
    if roi:
        return roi.replace('_', ' ')

    return f'{task.replace("_", " ")} segmentation'


def normalize_mask_volume(mask: np.ndarray, frame_count: int) -> np.ndarray:
    mask_data = np.asarray(mask)
    while mask_data.ndim > 3:
        if mask_data.shape[0] == 1:
            mask_data = np.squeeze(mask_data, axis=0)
        else:
            mask_data = np.argmax(mask_data, axis=0)

    if mask_data.ndim != 3:
        raise RuntimeError(f'Expected a 3D nnU-Net mask volume, received shape {mask_data.shape!r}.')

    min_size = min(mask_data.shape)
    slice_axis = max(index for index, size in enumerate(mask_data.shape) if size == min_size)
    mask_data = np.moveaxis(mask_data, slice_axis, 0)
    mask_data = mask_data > 0

    if mask_data.shape[0] < frame_count:
        padding = np.zeros((frame_count - mask_data.shape[0], *mask_data.shape[1:]), dtype=bool)
        mask_data = np.concatenate([mask_data, padding], axis=0)
    elif mask_data.shape[0] > frame_count:
        mask_data = mask_data[:frame_count]

    return mask_data.astype(bool)


def _create_seg_dataset(
    *,
    source_images: list,
    mask: np.ndarray,
    label: str,
    output_path: Path,
) -> Path:
    algorithm_identification = hd.AlgorithmIdentificationSequence(
        name='TotalSegmentator',
        family=codes.DCM.ArtificialIntelligence,
        version='2.11.0',
    )
    segment_description = hd.seg.SegmentDescription(
        segment_number=1,
        segment_label=label[:64] or 'nnU-Net segmentation',
        segmented_property_category=codes.SCT.Tissue,
        segmented_property_type=codes.SCT.Lesion,
        algorithm_type=hd.seg.SegmentAlgorithmTypeValues.AUTOMATIC,
        algorithm_identification=algorithm_identification,
    )

    segmentation_dataset = hd.seg.Segmentation(
        source_images=source_images,
        pixel_array=mask,
        segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
        segment_descriptions=[segment_description],
        series_instance_uid=generate_uid(),
        sop_instance_uid=generate_uid(),
        series_number=9101,
        instance_number=1,
        manufacturer='OHIF',
        manufacturer_model_name='nnU-Net Runtime',
        software_versions='3.13.0-beta.87',
        device_serial_number='OHIF-AI',
        content_description=f'{label[:48] or "nnU-Net"} Derived SEG',
        content_creator_name='OHIF^AI',
        transfer_syntax_uid=ExplicitVRLittleEndian,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    segmentation_dataset.save_as(str(output_path))
    return output_path


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
        dicom_paths = fetch_series_to_directory(
            request.get('studyInstanceUID', ''),
            request.get('seriesInstanceUID', ''),
            dicom_dir,
        )
        source_images = load_sorted_datasets(dicom_paths)

        source_instances = [path for path in dicom_dir.rglob('*') if path.is_file()]
        if len(source_instances) < 3:
            raise RuntimeError(
                'nnunet requires a volumetric source series with at least 3 instances. '
                f'Current series has {len(source_instances)} instance(s); localizer/scout series are not supported.'
            )

        input_volume = dicom_series_to_nifti(dicom_dir, temp_root / 'input-volume.nii.gz')
        output_mask_path = temp_root / 'totalsegmentator-output.nii.gz'
        command = [
            'TotalSegmentator',
            '-i',
            str(input_volume),
            '-o',
            str(output_mask_path),
            '--task',
            task,
            '--ml',
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

        if not output_mask_path.exists():
            output_mask_path = find_first_nifti(temp_root)
        output_mask = nib.load(output_mask_path).get_fdata()
        visualization = compute_mask_visualization(output_mask)
        if visualization is None:
            raise RuntimeError('TotalSegmentator produced an empty segmentation mask.')

        normalized_mask = normalize_mask_volume(output_mask, len(source_images))
        segmentation_label = _segmentation_label(task, roi)

        staged_output_dir = Path(args.response).resolve().parent / 'dicom-artifacts'
        staged_output_dir.mkdir(parents=True, exist_ok=True)
        segmentation_output_path = _create_seg_dataset(
            source_images=source_images,
            mask=normalized_mask,
            label=segmentation_label,
            output_path=staged_output_dir / f"{request.get('inferenceId', 'nnunet')}.seg.dcm",
        )

        payload = {
            'summary': (
                f'TotalSegmentator generated a DICOM SEG for ROI {roi} using {weights_task}.'
                if roi
                else f'TotalSegmentator generated a DICOM SEG using {weights_task}.'
            ),
            'resultFormat': 'dicom-seg',
            'dicomFiles': [str(segmentation_output_path)],
            'segmentation': {
                'label': segmentation_label,
                'segmentIndex': 1,
                **visualization,
            },
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
