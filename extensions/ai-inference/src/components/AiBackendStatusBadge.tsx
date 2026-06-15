import React from 'react';
import { useAiWorkflowStore } from '../stores/AiWorkflowStore';

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  borderRadius: '999px',
  padding: '0.35rem 0.7rem',
  fontSize: '0.75rem',
  border: '1px solid rgba(148, 163, 184, 0.35)',
};

export function AiBackendStatusBadge(): JSX.Element {
  const workflow = useAiWorkflowStore();
  const isHealthy = workflow.health?.status === 'ok';

  return (
    <div
      style={{
        ...badgeStyle,
        color: isHealthy ? '#166534' : '#991b1b',
        background: isHealthy ? 'rgba(134, 239, 172, 0.16)' : 'rgba(252, 165, 165, 0.16)',
      }}
    >
      <span>{isHealthy ? 'AI Backend Online' : 'AI Backend Offline'}</span>
      <span>{workflow.lastAction}</span>
    </div>
  );
}
