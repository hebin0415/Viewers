from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx
import pydicom

from app.core.settings import settings
from app.schemas.api import InferencePayload, InferenceRequest
from app.services.derived_dicom import create_rtstruct_dataset, create_seg_dataset, create_sr_dataset


@dataclass(frozen=True)
class PersistedArtifacts:
    artifact_uri: str | None
    derived_series_instance_uid: str | None
    derived_series_description: str | None
    study_instance_uid: str | None


def _format_submitted_time(submitted_at: str | None) -> str:
    if submitted_at:
        try:
            normalized = submitted_at.replace('Z', '+00:00')
            return datetime.fromisoformat(normalized).astimezone(UTC).strftime('%Y%m%d-%H%M%S')
        except ValueError:
            pass

    return datetime.now(UTC).strftime('%Y%m%d-%H%M%S')


def _build_derived_series_description(
    request: InferenceRequest,
    modality: str | None,
) -> str:
    series_type = (modality or request.taskType or 'AI').upper()
    timestamp = _format_submitted_time(request.submittedAt)
    model_name = ' '.join((request.modelName or 'AI').split()) or 'AI'
    prefix = 'AI | '
    suffix = f' {timestamp} {series_type}'
    available_model_length = max(1, 64 - len(prefix) - len(suffix))
    short_model_name = model_name[:available_model_length].rstrip() or 'AI'
    return f'{prefix}{short_model_name}{suffix}'


def _normalize_series_description(paths: list[Path], request: InferenceRequest) -> list[pydicom.Dataset]:
    datasets = [pydicom.dcmread(path, force=True) for path in paths]
    if not datasets:
        return []

    series_description = _build_derived_series_description(
        request,
        getattr(datasets[0], 'Modality', None),
    )

    for dataset, path in zip(datasets, paths):
        dataset.SeriesDescription = series_description
        if getattr(dataset, 'Modality', None) == 'RTSTRUCT':
            dataset.StructureSetLabel = series_description[:16]
        dataset.save_as(str(path), enforce_file_format=True)

    return datasets


def _stage_dicom_file(source_path: Path, destination_dir: Path) -> Path:
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination_path = destination_dir / source_path.name

    if source_path.resolve() != destination_path.resolve():
        shutil.copy2(source_path, destination_path)

    return destination_path


def _build_stow_body(paths: list[Path], boundary: str) -> bytes:
    chunks: list[bytes] = []
    for path in paths:
        chunks.extend(
            [
                f'--{boundary}\r\n'.encode('ascii'),
                b'Content-Type: application/dicom\r\n\r\n',
                path.read_bytes(),
                b'\r\n',
            ]
        )

    chunks.append(f'--{boundary}--\r\n'.encode('ascii'))
    return b''.join(chunks)


def _stow_instances(paths: list[Path]) -> None:
    if not settings.dicomweb_stow_url:
        return

    boundary = f'ai-inference-{uuid4().hex}'
    headers = {
        'Content-Type': f'multipart/related; type="application/dicom"; boundary={boundary}',
        **settings.dicomweb_headers,
    }

    response = httpx.post(
        settings.dicomweb_stow_url,
        content=_build_stow_body(paths, boundary),
        headers=headers,
        timeout=settings.dicomweb_timeout_seconds,
    )

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        detail = response.text.strip()
        message = f'Failed to STOW {len(paths)} DICOM instance(s) to {settings.dicomweb_stow_url}'
        if detail:
            message = f'{message}: {detail}'
        raise RuntimeError(message) from error


def _collect_generated_paths(
    *,
    inference_id: str,
    request: InferenceRequest,
    payload: InferencePayload,
    destination_dir: Path,
    dicom_files: list[str],
) -> list[Path]:
    if dicom_files:
        source_paths = [Path(file_path).expanduser().resolve() for file_path in dicom_files]
        missing_paths = [str(path) for path in source_paths if not path.exists()]
        if missing_paths:
            raise RuntimeError(f'Derived DICOM artifacts were not found: {", ".join(missing_paths)}')

        return [_stage_dicom_file(path, destination_dir) for path in source_paths]

    if not settings.derived_series_enabled or payload.storage.mode != 'derived-series':
        return []

    if payload.visualizations and payload.visualizations.segmentation:
        return [
            create_seg_dataset(
                inference_id=inference_id,
                request=request,
                payload=payload,
                destination_dir=destination_dir,
            )
        ]

    if request.taskType == 'detection':
        return [
            create_rtstruct_dataset(
                inference_id=inference_id,
                request=request,
                payload=payload,
                destination_dir=destination_dir,
            )
        ]

    if payload.summary:
        return [
            create_sr_dataset(
                inference_id=inference_id,
                request=request,
                payload=payload,
                destination_dir=destination_dir,
            )
        ]

    return []


def persist_dicom_artifacts(
    *,
    inference_id: str,
    request: InferenceRequest,
    payload: InferencePayload,
    dicom_files: list[str],
) -> PersistedArtifacts | None:
    destination_dir = Path(settings.artifacts_dir) / inference_id / 'dicom'
    staged_paths = _collect_generated_paths(
        inference_id=inference_id,
        request=request,
        payload=payload,
        destination_dir=destination_dir,
        dicom_files=dicom_files,
    )

    if not staged_paths:
        return None

    datasets = _normalize_series_description(staged_paths, request)
    primary_dataset = datasets[0]

    _stow_instances(staged_paths)

    return PersistedArtifacts(
        artifact_uri=staged_paths[0].as_uri(),
        derived_series_instance_uid=getattr(primary_dataset, 'SeriesInstanceUID', None),
        derived_series_description=getattr(primary_dataset, 'SeriesDescription', None),
        study_instance_uid=getattr(primary_dataset, 'StudyInstanceUID', None),
    )
