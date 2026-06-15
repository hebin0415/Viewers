import { IModelInferenceService } from '../interfaces/IModelInferenceService';
import { InferenceRequest, InferenceResult, ModelDescriptor } from '../../types';

export abstract class BaseModelInferenceService implements IModelInferenceService {
  public readonly descriptor: ModelDescriptor;

  protected constructor(descriptor: ModelDescriptor) {
    this.descriptor = descriptor;
  }

  public async run(request: InferenceRequest): Promise<InferenceResult> {
    return {
      inferenceId: request.inferenceId,
      modelName: this.descriptor.name,
      taskType: request.taskType,
      status: 'queued',
    };
  }
}