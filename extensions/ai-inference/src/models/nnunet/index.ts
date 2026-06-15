import { BaseModelInferenceService } from '../../core/base/BaseModelInferenceService';
import { SUPPORTED_MODELS } from '../../constants';

export class NnUNetInferenceService extends BaseModelInferenceService {
  constructor() {
    super(SUPPORTED_MODELS[0]);
  }
}