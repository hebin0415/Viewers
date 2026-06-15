from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.schemas.api import InferenceRequest, InferenceResponse
from app.services.result_store import result_store
from app.services.task_runner import submit_inference


router = APIRouter()


@router.post("/infer", response_model=InferenceResponse)
def infer(request: InferenceRequest, background_tasks: BackgroundTasks) -> InferenceResponse:
    return submit_inference(request, background_tasks)


@router.post("/infer/segmentation", response_model=InferenceResponse)
def infer_segmentation(
    request: InferenceRequest, background_tasks: BackgroundTasks
) -> InferenceResponse:
    patched_request = request.model_copy(update={"taskType": "segmentation"})
    return submit_inference(patched_request, background_tasks)


@router.post("/infer/detection", response_model=InferenceResponse)
def infer_detection(
    request: InferenceRequest, background_tasks: BackgroundTasks
) -> InferenceResponse:
    patched_request = request.model_copy(update={"taskType": "detection"})
    return submit_inference(patched_request, background_tasks)


@router.get("/results/{inference_id}", response_model=InferenceResponse)
def get_result(inference_id: str) -> InferenceResponse:
    result = result_store.get(inference_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Unknown inference result: {inference_id}")

    return result
