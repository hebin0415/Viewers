from fastapi import APIRouter

from app.schemas.api import ModelInfo
from app.services.model_registry import list_models


router = APIRouter()


@router.get("/models", response_model=list[ModelInfo])
def get_models() -> list[ModelInfo]:
    return list_models()
