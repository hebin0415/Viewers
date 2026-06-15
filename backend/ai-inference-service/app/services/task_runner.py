from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException

from app.schemas.api import (
    InferencePayload,
    InferenceReference,
    InferenceRequest,
    InferenceResponse,
    JobStatusResponse,
    utc_timestamp,
)
from app.services.model_registry import ModelRegistryEntry, get_entry
from app.services.queue import job_queue
from app.services.result_store import result_store


def _build_reference(request: InferenceRequest) -> InferenceReference:
    return InferenceReference(
        studyInstanceUID=request.studyInstanceUID,
        seriesInstanceUID=request.seriesInstanceUID,
    )


def _build_queued_response(request: InferenceRequest, job_id: str, entry: ModelRegistryEntry) -> InferenceResponse:
    return InferenceResponse(
        jobId=job_id,
        inferenceId=request.inferenceId,
        status="queued",
        modelName=entry.name,
        taskType=request.taskType,
        resultFormat="pending",
        reference=_build_reference(request),
        payload=InferencePayload(summary=f"{entry.name} job queued for {request.taskType}"),
    )


def _save_job_status(
    *,
    job_id: str,
    request: InferenceRequest,
    entry: ModelRegistryEntry,
    status: str,
    result_ready: bool = False,
    error: str | None = None,
) -> None:
    job_queue.save(
        JobStatusResponse(
            jobId=job_id,
            inferenceId=request.inferenceId,
            status=status,
            modelName=entry.name,
            taskType=request.taskType,
            updatedAt=utc_timestamp(),
            resultReady=result_ready,
            error=error,
        )
    )


def _validate_request(request: InferenceRequest) -> ModelRegistryEntry:
    try:
        entry = get_entry(request.modelName)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    if request.taskType not in entry.task_types:
        raise HTTPException(
            status_code=400,
            detail=f"Model {entry.name} does not support task type {request.taskType}",
        )

    return entry


def execute_inference(request: InferenceRequest, job_id: str, entry: ModelRegistryEntry) -> InferenceResponse:
    _save_job_status(job_id=job_id, request=request, entry=entry, status="running")

    try:
        result = entry.runner.infer(request, job_id)
        # The scaffold stores results in memory so API contracts and OHIF wiring
        # can be validated without requiring a persistent jobs backend.
        completed_result = result.model_copy(update={"completedAt": utc_timestamp()})
        result_store.save(completed_result)
        _save_job_status(
            job_id=job_id,
            request=request,
            entry=entry,
            status=completed_result.status,
            result_ready=True,
        )
        return completed_result
    except Exception as error:
        message = str(error)
        _save_job_status(
            job_id=job_id,
            request=request,
            entry=entry,
            status="failed",
            error=message,
        )
        raise HTTPException(status_code=500, detail=message) from error


def submit_inference(request: InferenceRequest, background_tasks: BackgroundTasks | None = None) -> InferenceResponse:
    entry = _validate_request(request)
    job_id = str(uuid4())

    if request.options.run_async:
        _save_job_status(job_id=job_id, request=request, entry=entry, status="queued")

        if background_tasks is None:
            return execute_inference(request, job_id, entry)

        background_tasks.add_task(execute_inference, request, job_id, entry)
        return _build_queued_response(request, job_id, entry)

    return execute_inference(request, job_id, entry)
