from __future__ import annotations

import json
import os
from email.parser import BytesParser
from email.policy import default
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

import dicom2nifti
import httpx
import numpy as np
import pydicom


def load_request(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_response(path: str, payload: dict) -> None:
    response_path = Path(path)
    response_path.parent.mkdir(parents=True, exist_ok=True)
    response_path.write_text(json.dumps(payload), encoding='utf-8')


def get_dicomweb_headers() -> dict[str, str]:
    raw = os.environ.get('AI_INFERENCE_DICOMWEB_HEADERS_JSON', '').strip()
    if not raw:
        return {}

    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise RuntimeError('AI_INFERENCE_DICOMWEB_HEADERS_JSON must be a JSON object.')

    return {str(key): str(value) for key, value in parsed.items()}


def require_dicomweb_retrieve_base_url() -> str:
    base_url = os.environ.get('AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL', '').strip()
    if not base_url:
        raise RuntimeError('Set AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL for real runtime inference.')

    return base_url.rstrip('/')


def fetch_series_to_directory(study_uid: str, series_uid: str, output_dir: Path) -> list[Path]:
    if not study_uid or not series_uid:
        raise RuntimeError('Both studyInstanceUID and seriesInstanceUID are required for real runtime inference.')

    output_dir.mkdir(parents=True, exist_ok=True)
    url = (
        f'{require_dicomweb_retrieve_base_url()}/studies/{quote(study_uid, safe="")}'
        f'/series/{quote(series_uid, safe="")}'
    )
    headers = get_dicomweb_headers()
    headers['Accept'] = 'multipart/related; type="application/dicom"; transfer-syntax=*'

    response = httpx.get(url, headers=headers, timeout=300.0, follow_redirects=True)
    response.raise_for_status()

    dicom_parts = _parse_multipart_dicom_parts(response.content, response.headers.get('Content-Type', ''))
    if not dicom_parts:
        raise RuntimeError(f'No DICOM instances were returned by {url}.')

    saved_paths: list[Path] = []
    for index, payload in enumerate(dicom_parts):
        dataset = pydicom.dcmread(BytesIO(payload), stop_before_pixels=True, force=True)
        instance_number = _safe_int(getattr(dataset, 'InstanceNumber', index))
        sop_instance_uid = getattr(dataset, 'SOPInstanceUID', f'instance-{index:04d}')
        file_path = output_dir / f'{instance_number:06d}-{sop_instance_uid}.dcm'
        file_path.write_bytes(payload)
        saved_paths.append(file_path)

    return sorted(saved_paths)


def load_sorted_datasets(dicom_paths: list[Path]) -> list[pydicom.Dataset]:
    datasets = [pydicom.dcmread(path, force=True) for path in dicom_paths]
    datasets.sort(key=_dataset_sort_key)
    return datasets


def representative_slice_image(datasets: list[pydicom.Dataset]) -> tuple[np.ndarray, int]:
    if not datasets:
        raise RuntimeError('No DICOM datasets were loaded for representative slice extraction.')

    slice_index = len(datasets) // 2
    return dataset_to_rgb_image(datasets[slice_index]), slice_index


def sampled_slice_images(
    datasets: list[pydicom.Dataset],
    *,
    sparse_sample_count: int = 1,
    full_series_review: bool = False,
) -> list[tuple[np.ndarray, int]]:
    if not datasets:
        raise RuntimeError('No DICOM datasets were loaded for slice sampling.')

    if full_series_review:
        slice_indexes = list(range(len(datasets)))
    else:
        sample_count = max(1, min(int(sparse_sample_count or 1), len(datasets)))
        if sample_count == 1:
            slice_indexes = [len(datasets) // 2]
        else:
            slice_indexes = []
            for position in np.linspace(0, len(datasets) - 1, num=sample_count):
                slice_index = int(round(float(position)))
                if slice_index not in slice_indexes:
                    slice_indexes.append(slice_index)

    return [(dataset_to_rgb_image(datasets[slice_index]), slice_index) for slice_index in slice_indexes]


def dataset_to_rgb_image(dataset: pydicom.Dataset) -> np.ndarray:
    image = dataset.pixel_array.astype(np.float32)
    if image.ndim > 2:
        image = image.squeeze()
    image = _apply_rescale(dataset, image)
    image = _normalize_to_uint8(image)
    return np.stack([image, image, image], axis=-1)


def dicom_series_to_nifti(dicom_dir: Path, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dicom2nifti.dicom_series_to_nifti(str(dicom_dir), str(output_path), reorient_nifti=True)
    return output_path


def compute_mask_visualization(mask: np.ndarray) -> dict[str, float | int] | None:
    mask_data = np.asarray(mask)
    while mask_data.ndim > 3:
        if mask_data.shape[0] == 1:
            mask_data = np.squeeze(mask_data, axis=0)
        else:
            mask_data = np.argmax(mask_data, axis=0)

    if mask_data.ndim != 3:
        raise RuntimeError(f'Expected a 3D mask volume, received shape {mask_data.shape!r}.')

    foreground = mask_data > 0
    if not np.any(foreground):
        return None

    # Reoriented NIfTI volumes are not guaranteed to be stored as (slice, row, col).
    min_size = min(mask_data.shape)
    slice_axis = max(index for index, size in enumerate(mask_data.shape) if size == min_size)
    slice_coords = np.where(foreground)[slice_axis]
    slice_index = int(np.median(slice_coords))
    slice_mask = np.take(foreground, indices=slice_index, axis=slice_axis)
    if not np.any(slice_mask):
        slice_index = int(slice_coords[0])
        slice_mask = np.take(foreground, indices=slice_index, axis=slice_axis)

    ys, xs = np.where(slice_mask)
    height, width = slice_mask.shape
    x_min = int(xs.min())
    x_max = int(xs.max())
    y_min = int(ys.min())
    y_max = int(ys.max())

    return {
        'x': x_min / width,
        'y': y_min / height,
        'width': (x_max - x_min + 1) / width,
        'height': (y_max - y_min + 1) / height,
        'sliceIndex': slice_index,
    }


def find_first_nifti(output_dir: Path) -> Path:
    candidates = sorted(output_dir.rglob('*.nii.gz')) + sorted(output_dir.rglob('*.nii'))
    if not candidates:
        raise RuntimeError(f'No NIfTI output was produced under {output_dir}.')
    return candidates[0]


def normalize_device_for_torch(device: str) -> str:
    normalized = (device or '').strip().lower()
    if normalized.startswith('cuda:'):
        return normalized.split(':', 1)[1]
    if normalized == 'cuda':
        return '0'
    if normalized in {'gpu', 'cpu', 'mps'}:
        return normalized
    return 'cpu'


def normalize_device_for_totalsegmentator(device: str) -> str:
    normalized = (device or '').strip().lower()
    if normalized.startswith('cuda') or normalized == 'gpu':
        return 'gpu'
    if normalized == 'mps':
        return 'mps'
    return 'cpu'


def _parse_multipart_dicom_parts(content: bytes, content_type: str) -> list[bytes]:
    if 'multipart/' not in content_type.lower():
        return [content] if content else []

    header_block = f'Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n'.encode('utf-8')
    message = BytesParser(policy=default).parsebytes(header_block + content)
    return [part.get_payload(decode=True) for part in message.iter_parts() if part.get_payload(decode=True)]


def _safe_int(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _dataset_sort_key(dataset: pydicom.Dataset) -> tuple[float, int]:
    image_position = getattr(dataset, 'ImagePositionPatient', None)
    z_position = float(image_position[2]) if image_position and len(image_position) >= 3 else 0.0
    return z_position, _safe_int(getattr(dataset, 'InstanceNumber', 0))


def _apply_rescale(dataset: pydicom.Dataset, image: np.ndarray) -> np.ndarray:
    slope = float(getattr(dataset, 'RescaleSlope', 1.0) or 1.0)
    intercept = float(getattr(dataset, 'RescaleIntercept', 0.0) or 0.0)
    return image * slope + intercept


def _normalize_to_uint8(image: np.ndarray) -> np.ndarray:
    lower = float(np.percentile(image, 1))
    upper = float(np.percentile(image, 99))
    if upper <= lower:
        upper = lower + 1.0
    clipped = np.clip(image, lower, upper)
    normalized = ((clipped - lower) / (upper - lower) * 255.0).astype(np.uint8)
    return normalized
