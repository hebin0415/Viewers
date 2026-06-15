export type InferenceTaskType = 'segmentation' | 'detection' | 'classification';

export type ModelFamily = 'nnunet' | 'yolo' | 'monai';
export type IntegrationMode = 'scaffold' | 'external-runner';

export type InferenceJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ResultStorageMode = 'overlay-only' | 'derived-series';
export type RuntimeServiceStatus = 'online' | 'offline' | 'disabled';
export type WorkflowHealthIndicator =
  | 'unknown'
  | 'online'
  | 'degraded'
  | 'offline'
  | 'recentlyOffline';

export interface SegmentationVisualization {
  label: string;
  segmentIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sliceIndex?: number;
}

export interface DetectionVisualization {
  id: string;
  label: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sliceIndex?: number;
}

export interface InferenceVisualizations {
  segmentation?: SegmentationVisualization | null;
  detections?: DetectionVisualization[];
}

export interface ModelDescriptor {
  family: ModelFamily;
  name: string;
  version?: string;
  taskTypes: InferenceTaskType[];
  integrationMode: IntegrationMode;
  configured: boolean;
  configurationHint?: string | null;
}

export interface RuntimeServiceHealth {
  family: ModelFamily | string;
  label: string;
  status: RuntimeServiceStatus;
  enabled: boolean;
  configured: boolean;
  port: number;
}

export interface ResultStorageInfo {
  mode: ResultStorageMode;
  derivedSeriesInstanceUID?: string | null;
  derivedSeriesDescription?: string | null;
}

export interface HealthStatus {
  status: string;
  service: string;
  version: string;
  availableModels: number;
  backendStatus: string;
  enabledRuntimeCount: number;
  onlineRuntimeCount: number;
  checkedAt: string;
  runtimeServices: RuntimeServiceHealth[];
}

export interface InferenceRequestOptions {
  async?: boolean;
  returnContours?: boolean;
  confidenceThreshold?: number;
}

export interface InferenceRequest {
  inferenceId?: string;
  modelName: string;
  taskType: InferenceTaskType;
  submittedAt?: string;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  options?: InferenceRequestOptions;
}

export interface InferenceReference {
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
}

export interface InferencePayload {
  summary: string;
  artifactUri?: string | null;
  visualizations?: InferenceVisualizations | null;
  storage?: ResultStorageInfo | null;
}

export interface InferenceResult {
  jobId: string;
  inferenceId: string;
  status: InferenceJobStatus;
  modelName: string;
  taskType: InferenceTaskType;
  resultFormat: string;
  reference: InferenceReference;
  payload: InferencePayload;
  createdAt?: string;
  completedAt?: string | null;
  error?: string | null;
}

export interface JobStatusResult {
  jobId: string;
  inferenceId: string;
  status: InferenceJobStatus;
  modelName: string;
  taskType: InferenceTaskType;
  updatedAt?: string;
  resultReady?: boolean;
  error?: string | null;
}

export interface DeleteSeriesResponse {
  seriesInstanceUID: string;
  orthancSeriesIds: string[];
  deletedSeriesCount: number;
}

export interface WorkflowTask {
  jobId: string;
  inferenceId: string;
  modelName: string;
  taskType: InferenceTaskType;
  viewportId?: string | null;
  seriesNumber?: number | string | null;
  seriesLabel: string;
  status: InferenceJobStatus;
  submittedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

export interface WorkflowState {
  backendUrl: string;
  selectedModelName: string;
  selectedTaskType: InferenceTaskType;
  studyInstanceUID: string;
  seriesInstanceUID: string;
  runAsync: boolean;
  isBusy: boolean;
  lastAction: string;
  error: string | null;
  health: HealthStatus | null;
  healthIndicatorState: WorkflowHealthIndicator;
  lastHealthCheckedAt: string | null;
  lastHealthyAt: string | null;
  modelsLoadedForBackendUrl: string | null;
  models: ModelDescriptor[];
  lastJob: JobStatusResult | null;
  lastResult: InferenceResult | null;
  tasks: WorkflowTask[];
  renderedAnnotationIds: string[];
  renderedSegmentationId: string | null;
}
