import {
  DeleteSeriesResponse,
  HealthStatus,
  InferenceRequest,
  InferenceResult,
  JobStatusResult,
  ModelDescriptor,
} from '../types';

export class AiInferenceApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async buildError(path: string, response: Response): Promise<Error> {
    const rawMessage = await response.text();
    let message = rawMessage || `Request failed: ${response.status}`;

    try {
      const parsed = JSON.parse(rawMessage) as { detail?: string };
      if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
        message = parsed.detail;
      }
    } catch {
      // Keep the raw response text when the payload is not JSON.
    }

    if (path.startsWith('/series/') && response.status === 404 && message === 'Not Found') {
      message =
        'Backend delete endpoint is unavailable. Restart ai-inference-service so /series/{seriesInstanceUID} is loaded.';
    }

    return new Error(message);
  }

  private async request<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      throw await this.buildError(path, response);
    }

    return response.json() as Promise<TResponse>;
  }

  public async getHealth(): Promise<HealthStatus> {
    return this.request<HealthStatus>('/health');
  }

  public async getModels(): Promise<ModelDescriptor[]> {
    return this.request<ModelDescriptor[]>('/models');
  }

  public async infer(request: InferenceRequest): Promise<InferenceResult> {
    return this.request<InferenceResult>('/infer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
  }

  public async getJob(jobId: string): Promise<JobStatusResult> {
    return this.request<JobStatusResult>(`/jobs/${jobId}`);
  }

  public async getResult(inferenceId: string): Promise<InferenceResult> {
    return this.request<InferenceResult>(`/results/${inferenceId}`);
  }

  public async deleteSeries(seriesInstanceUID: string): Promise<DeleteSeriesResponse> {
    return this.request<DeleteSeriesResponse>(`/series/${seriesInstanceUID}`, {
      method: 'DELETE',
    });
  }
}
