from __future__ import annotations

import httpx

from app.core.settings import settings
from app.schemas.api import DeleteSeriesResponse


AI_RESULT_PREFIX = 'AI |'


class DeleteSeriesError(RuntimeError):
    """Base failure for Orthanc series deletion."""


class DeleteSeriesNotConfiguredError(DeleteSeriesError):
    """Raised when the Orthanc REST base URL cannot be resolved."""


class DeleteSeriesNotFoundError(DeleteSeriesError):
    """Raised when Orthanc cannot find the requested SeriesInstanceUID."""


class DeleteSeriesForbiddenError(DeleteSeriesError):
    """Raised when the target series is not an AI-derived result."""


def _resolve_orthanc_base_url() -> str:
    if settings.orthanc_base_url:
        return settings.orthanc_base_url.rstrip('/')

    candidate = settings.dicomweb_retrieve_base_url
    if not candidate and settings.dicomweb_stow_url:
        candidate = settings.dicomweb_stow_url.removesuffix('/studies')

    if not candidate:
        candidate = 'http://127.0.0.1:8042'

    normalized = candidate.rstrip('/')
    if normalized.endswith('/dicom-web'):
        normalized = normalized.removesuffix('/dicom-web')

    return normalized


def _is_ai_result_series_description(value: str | None) -> bool:
    return str(value or '').strip().upper().startswith(AI_RESULT_PREFIX.upper())


def _fetch_series_description(orthanc_series_id: str) -> str | None:
    orthanc_base_url = _resolve_orthanc_base_url()
    response = httpx.get(
        f'{orthanc_base_url}/series/{orthanc_series_id}',
        headers=settings.dicomweb_headers,
        timeout=settings.dicomweb_timeout_seconds,
    )
    response.raise_for_status()

    payload = response.json()
    if not isinstance(payload, dict):
        raise DeleteSeriesError('Orthanc series lookup returned an unexpected payload.')

    main_tags = payload.get('MainDicomTags')
    if isinstance(main_tags, dict):
        description = main_tags.get('SeriesDescription')
        if isinstance(description, str):
            return description

    requested_tags = payload.get('RequestedTags')
    if isinstance(requested_tags, dict):
        description = requested_tags.get('SeriesDescription')
        if isinstance(description, str):
            return description

    return None


def _lookup_orthanc_series_ids(series_instance_uid: str) -> list[str]:
    orthanc_base_url = _resolve_orthanc_base_url()
    response = httpx.post(
        f'{orthanc_base_url}/tools/find',
        json={
            'Level': 'Series',
            'Query': {
                'SeriesInstanceUID': series_instance_uid,
            },
        },
        headers={
            'Content-Type': 'application/json',
            **settings.dicomweb_headers,
        },
        timeout=settings.dicomweb_timeout_seconds,
    )
    response.raise_for_status()

    series_ids = response.json()
    if not isinstance(series_ids, list):
        raise DeleteSeriesError('Orthanc lookup returned an unexpected payload.')

    normalized_ids = [str(series_id) for series_id in series_ids if str(series_id).strip()]
    if not normalized_ids:
        raise DeleteSeriesNotFoundError(
            f'Orthanc could not find series {series_instance_uid} for deletion.'
        )

    return normalized_ids


def delete_series(series_instance_uid: str) -> DeleteSeriesResponse:
    orthanc_base_url = _resolve_orthanc_base_url()
    orthanc_series_ids = _lookup_orthanc_series_ids(series_instance_uid)

    for orthanc_series_id in orthanc_series_ids:
        series_description = _fetch_series_description(orthanc_series_id)
        if not _is_ai_result_series_description(series_description):
            raise DeleteSeriesForbiddenError(
                f'Series {series_instance_uid} is not an AI result and cannot be deleted from Orthanc.'
            )

        response = httpx.delete(
            f'{orthanc_base_url}/series/{orthanc_series_id}',
            headers=settings.dicomweb_headers,
            timeout=settings.dicomweb_timeout_seconds,
        )
        response.raise_for_status()

    return DeleteSeriesResponse(
        seriesInstanceUID=series_instance_uid,
        orthancSeriesIds=orthanc_series_ids,
        deletedSeriesCount=len(orthanc_series_ids),
    )
