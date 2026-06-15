import { AiBackendStatusBadge } from './components/AiBackendStatusBadge';
import { aiWorkflowStore } from './stores/AiWorkflowStore';

export default function getToolbarModule() {
  return [
    {
      name: 'ohif.aiInference.backendStatus',
      defaultComponent: AiBackendStatusBadge,
    },
    {
      name: 'evaluate.aiInference.backendStatus',
      evaluate: () => {
        const workflow = aiWorkflowStore.getState();
        return {
          disabled: false,
          className: workflow.health?.status === 'ok' ? 'text-primary-active' : '',
        };
      },
    },
  ];
}
