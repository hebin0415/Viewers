from fastapi import APIRouter, HTTPException

from app.schemas.api import JobStatusResponse
from app.services.queue import job_queue


router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    job = job_queue.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")

    return job
