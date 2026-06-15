import { BaseModelInferenceService } from '../../core/base/BaseModelInferenceService';
import { SUPPORTED_MODELS } from '../../constants';

export class MonaiInferenceService extends BaseModelInferenceService {
  constructor() {
    super(SUPPORTED_MODELS[2]);
  }
}