import React from 'react';
import { useAiWorkflowStore } from '../stores/AiWorkflowStore';

const overlayStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  padding: '0.4rem 0.55rem',
  borderRadius: '0.45rem',
  background: 'rgba(15, 23, 42, 0.72)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  color: '#f8fafc',
  fontSize: '0.72rem',
  maxWidth: '15rem',
};

export function AiViewportOverlay(): JSX.Element | null {
  const workflow = useAiWorkflowStore();
  const result = workflow.lastResult;

  if (!result && !workflow.focusedFinding) {
    return null;
  }

  const segmentationReady = Boolean(result?.payload.visualizations?.segmentation);
  const detectionCount = result?.payload.visualizations?.detections?.length ?? 0;
  const storageMode = result?.payload.storage?.mode ?? 'overlay-only';
  const focusedFinding = workflow.focusedFinding;

  return (
    <div
      style={overlayStyle}
      data-cy="ai-viewport-overlay"
    >
      <div style={{ fontWeight: 700 }}>AI Result</div>
      {result ? (
        <>
          <div>
            {result.modelName} / {result.taskType}
          </div>
          <div>Status: {result.status}</div>
          <div>Storage: {storageMode}</div>
          <div>Segmentation: {segmentationReady ? 'ready' : 'none'}</div>
          <div>Detections: {detectionCount}</div>
        </>
      ) : null}
      {focusedFinding ? (
        <div
          data-cy="ai-focused-finding-overlay"
          style={{
            marginTop: '0.3rem',
            paddingTop: '0.3rem',
            borderTop: '1px solid rgba(148, 163, 184, 0.2)',
            display: 'grid',
            gap: '0.1rem',
          }}
        >
          <div style={{ fontWeight: 700 }}>Focused Finding</div>
          <div>Site: {focusedFinding.anatomicalSite}</div>
          <div>Type: {focusedFinding.lesionType}</div>
          <div>Size: {focusedFinding.sizeText}</div>
          <div>Assessment: {focusedFinding.assessment}</div>
          <div>Confidence: {focusedFinding.confidenceText}</div>
          <div>Slice: {focusedFinding.sliceText}</div>
        </div>
      ) : null}
    </div>
  );
}
