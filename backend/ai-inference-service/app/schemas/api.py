from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


TaskType = Literal["segmentation", "detection", "classification"]
JobStatus = Literal["queued", "running", "completed", "failed"]
IntegrationMode = Literal["scaffold", "external-runner"]
ResultStorageMode = Literal["overlay-only", "derived-series"]


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    availableModels: int
    backendStatus: str = 'online'
    enabledRuntimeCount: int = 0
    onlineRuntimeCount: int = 0
    checkedAt: str = Field(default_factory=utc_timestamp)
    runtimeServices: list['RuntimeServiceHealth'] = Field(default_factory=list)


class RuntimeServiceHealth(BaseModel):
    family: str
    label: str
    status: str
    enabled: bool = False
    configured: bool = False
    port: int


class ModelInfo(BaseModel):
    name: str
    family: str
    version: str
    taskTypes: list[TaskType]
    integrationMode: IntegrationMode
    configured: bool = False
    configurationHint: str | None = None


class InferenceExecutionOptions(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    run_async: bool = Field(default=True, alias="async")
    returnContours: bool = False
    confidenceThreshold: float = Field(default=0.25, ge=0.0, le=1.0)
    sparseSampleCount: int = Field(default=1, ge=1, le=512)
    fullSeriesReview: bool = False


class InferenceRequest(BaseModel):
    inferenceId: str = Field(default_factory=lambda: str(uuid4()))
    modelName: str
    taskType: TaskType
    submittedAt: str | None = None
    studyInstanceUID: str | None = None
    seriesInstanceUID: str | None = None
    options: InferenceExecutionOptions = Field(default_factory=InferenceExecutionOptions)


class InferenceReference(BaseModel):
    studyInstanceUID: str | None = None
    seriesInstanceUID: str | None = None


class SegmentationVisualization(BaseModel):
    label: str
    segmentIndex: int = 1
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(ge=0.0, le=1.0)
    height: float = Field(ge=0.0, le=1.0)
    sliceIndex: int | None = None


class DetectionVisualization(BaseModel):
    id: str
    label: str
    confidence: float = Field(ge=0.0, le=1.0)
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(ge=0.0, le=1.0)
    height: float = Field(ge=0.0, le=1.0)
    sliceIndex: int | None = None
    anatomicalSite: str | None = None
    lesionType: str | None = None
    sizeText: str | None = None
    assessment: str | None = None
    annotationText: str | None = None


class InferenceVisualizations(BaseModel):
    segmentation: SegmentationVisualization | None = None
    detections: list[DetectionVisualization] = Field(default_factory=list)


class ResultStorageInfo(BaseModel):
    mode: ResultStorageMode = "overlay-only"
    derivedSeriesInstanceUID: str | None = None
    derivedSeriesDescription: str | None = None


class InferencePayload(BaseModel):
    summary: str
    artifactUri: str | None = None
    visualizations: InferenceVisualizations | None = None
    storage: ResultStorageInfo = Field(default_factory=ResultStorageInfo)


class InferenceResponse(BaseModel):
    jobId: str
    inferenceId: str
    status: JobStatus
    modelName: str
    taskType: TaskType
    resultFormat: str
    reference: InferenceReference
    payload: InferencePayload
    createdAt: str = Field(default_factory=utc_timestamp)
    completedAt: str | None = None
    error: str | None = None


class JobStatusResponse(BaseModel):
    jobId: str
    inferenceId: str
    status: JobStatus
    modelName: str
    taskType: TaskType
    updatedAt: str = Field(default_factory=utc_timestamp)
    resultReady: bool = False
    error: str | None = None


class DeleteSeriesResponse(BaseModel):
    seriesInstanceUID: str
    orthancSeriesIds: list[str] = Field(default_factory=list)
    deletedSeriesCount: int = 0
