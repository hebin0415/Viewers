from fastapi import APIRouter, HTTPException, status
import httpx

from app.schemas.api import DeleteSeriesResponse
from app.services.series_delete import (
    DeleteSeriesError,
    DeleteSeriesForbiddenError,
    DeleteSeriesNotConfiguredError,
    DeleteSeriesNotFoundError,
    delete_series,
)


router = APIRouter()


@router.delete('/series/{series_instance_uid}', response_model=DeleteSeriesResponse)
def delete_series_route(series_instance_uid: str) -> DeleteSeriesResponse:
    try:
        return delete_series(series_instance_uid)
    except DeleteSeriesForbiddenError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    except DeleteSeriesNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except DeleteSeriesNotConfiguredError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f'Orthanc deletion request failed: {error.response.status_code}',
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f'Orthanc deletion request failed: {error}',
        ) from error
    except DeleteSeriesError as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)) from error
