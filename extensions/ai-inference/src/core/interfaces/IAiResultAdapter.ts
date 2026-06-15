import { InferenceResult } from '../../types';

export interface IAiResultAdapter<TRawResult> {
  adapt(rawResult: TRawResult): InferenceResult;
}