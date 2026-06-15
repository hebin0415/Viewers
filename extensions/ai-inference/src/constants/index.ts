import { ModelDescriptor } from '../types';

export const PANEL_ID = 'ai-inference-panel';
export const AI_PANEL_ICON_NAME = 'tab-ai-inference';
export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';

export const SUPPORTED_MODELS: ModelDescriptor[] = [
  {
    family: 'nnunet',
    name: 'nnunet',
    version: '0.1.0',
    taskTypes: ['segmentation'],
    integrationMode: 'external-runner',
    configured: false,
    configurationHint: 'Load models from the backend to inspect the nnU-Net runner command.',
  },
  {
    family: 'yolo',
    name: 'yolo',
    version: '0.1.0',
    taskTypes: ['detection'],
    integrationMode: 'external-runner',
    configured: false,
    configurationHint: 'Load models from the backend to inspect the YOLO runner command.',
  },
  {
    family: 'monai',
    name: 'monai',
    version: '0.1.0',
    taskTypes: ['segmentation', 'detection', 'classification'],
    integrationMode: 'external-runner',
    configured: false,
    configurationHint: 'Load models from the backend to inspect the MONAI runner command.',
  },
];
