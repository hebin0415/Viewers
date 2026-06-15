import { InferenceResult } from '../../types';

export interface IModelRenderer {
  render(result: InferenceResult): Promise<void>;
}