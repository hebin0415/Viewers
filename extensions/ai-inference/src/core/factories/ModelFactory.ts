import { ModelFamily } from '../../types';
import { MonaiInferenceService } from '../../models/monai';
import { NnUNetInferenceService } from '../../models/nnunet';
import { YoloInferenceService } from '../../models/yolo';
import { IModelInferenceService } from '../interfaces/IModelInferenceService';

export class ModelFactory {
  public static listSupportedFamilies(): ModelFamily[] {
    return ['nnunet', 'yolo', 'monai'];
  }

  public static createService(family: ModelFamily): IModelInferenceService {
    switch (family) {
      case 'nnunet':
        return new NnUNetInferenceService();
      case 'yolo':
        return new YoloInferenceService();
      case 'monai':
        return new MonaiInferenceService();
      default:
        throw new Error(`Unsupported model family: ${family}`);
    }
  }
}