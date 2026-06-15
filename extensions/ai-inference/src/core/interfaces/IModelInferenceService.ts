import { InferenceRequest, InferenceResult, ModelDescriptor } from '../../types';

export interface IModelInferenceService {
  readonly descriptor: ModelDescriptor;
  run(request: InferenceRequest): Promise<InferenceResult>;
}