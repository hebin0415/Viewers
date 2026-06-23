import React, { useEffect, useState } from 'react';
import { Types } from '@ohif/core';
import { SUPPORTED_MODELS } from '../constants';
import { useAiWorkflowStore } from '../stores/AiWorkflowStore';
import { InferenceTaskType, WorkflowTask } from '../types';

const HEALTH_REFRESH_INTERVAL_MS = 2000;
const AI_RESULT_PREFIX = 'AI |';

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.65rem',
  boxSizing: 'border-box',
  height: '100%',
  maxHeight: '100vh',
  minHeight: 0,
  overflowX: 'hidden',
  overflowY: 'auto',
  padding: '1rem',
  color: '#f3f4f6',
};

const cardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.5rem',
  padding: '0.72rem',
  background: 'rgba(15, 23, 42, 0.55)',
};

const fieldLabelStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '0.76rem',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const inlineFieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '72px minmax(0, 1fr)',
  alignItems: 'center',
  gap: '0.45rem',
};

const stackedFieldGroupStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: '0.55rem',
};

const compactFieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '72px minmax(0, 1fr)',
  alignItems: 'center',
  gap: '0.45rem',
};

const inputStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: '0.45rem',
  padding: '0.48rem 0.62rem',
  background: 'rgba(15, 23, 42, 0.8)',
  color: '#f8fafc',
  minWidth: 0,
  width: '100%',
  fontSize: '0.84rem',
};

const buttonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: '0.45rem',
  padding: '0.56rem 0.9rem',
  background: 'rgba(30, 41, 59, 0.95)',
  color: '#f8fafc',
  cursor: 'pointer',
  fontWeight: 600,
};

const tableShellStyle: React.CSSProperties = {
  overflowX: 'auto',
  overflowY: 'auto',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '0.45rem',
  maxHeight: '100%',
  background: 'rgba(2, 6, 23, 0.28)',
};

const tableStyle: React.CSSProperties = {
  width: 'max-content',
  minWidth: '100%',
  tableLayout: 'auto',
  borderCollapse: 'collapse',
};

const headerCellStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '0.44rem 0.48rem',
  fontSize: '0.75rem',
  color: '#cbd5e1',
  borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
  whiteSpace: 'nowrap',
  fontWeight: 600,
  position: 'sticky',
  top: 0,
  zIndex: 1,
  background: 'rgba(15, 23, 42, 0.96)',
  boxShadow: '0 1px 0 rgba(148, 163, 184, 0.12)',
};

const bodyCellStyle: React.CSSProperties = {
  padding: '0.46rem 0.48rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  fontSize: '0.76rem',
  textAlign: 'center',
};

const numericCellStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
};

const alignedCompactCellStyle: React.CSSProperties = {
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
};

const compactHintStyle: React.CSSProperties = {
  fontSize: '0.76rem',
  color: '#94a3b8',
  lineHeight: 1.35,
};

const TASKS_SHELL_CLASS_NAME = 'aiInferenceTasksShell';

const TASKS_SHELL_CSS = `
  .${TASKS_SHELL_CLASS_NAME} {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .${TASKS_SHELL_CLASS_NAME}::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
`;

type AiInferencePanelProps = {
  commandsManager: Types.Extensions.ExtensionParams['commandsManager'];
  servicesManager: Types.Extensions.ExtensionParams['servicesManager'];
};

const formatCompactTime = (value?: string | null) => {
  if (!value) {
    return '--:--';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '--:--';
  }

  return parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDuration = (task: WorkflowTask) => {
  const startValue = task.startedAt ?? task.submittedAt;
  const endValue = task.completedAt ?? (isTaskActive(task) ? new Date().toISOString() : startValue);
  const startMs = new Date(startValue).getTime();
  const endMs = new Date(endValue).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return '--';
  }

  const totalSeconds = Math.round((endMs - startMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const formatSeriesNumber = (value?: number | string | null) => {
  if (value === undefined || value === null || value === '') {
    return '--';
  }

  return String(value);
};

const isAiResultLabel = (value?: string | null) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .startsWith(AI_RESULT_PREFIX.toUpperCase());

const getTaskStatusLabel = (status: WorkflowTask['status']) => {
  switch (status) {
    case 'queued':
      return 'waiting';
    case 'completed':
      return 'done';
    default:
      return status;
  }
};

const getTaskStatusColor = (status: WorkflowTask['status']) => {
  switch (status) {
    case 'completed':
      return '#86efac';
    case 'running':
      return '#93c5fd';
    case 'queued':
      return '#facc15';
    case 'failed':
      return '#fca5a5';
    default:
      return '#cbd5e1';
  }
};

const getPrimaryActionLabel = (
  isBusy: boolean,
  activeTask: WorkflowTask | null,
  canRunSelectedModel: boolean
) => {
  if (isBusy) {
    return 'Starting...';
  }

  if (activeTask?.status === 'queued') {
    return 'Queued';
  }

  if (activeTask?.status === 'running') {
    return 'Running...';
  }

  if (!canRunSelectedModel) {
    return 'Unavailable';
  }

  return 'Start';
};

const isTaskActive = (task?: WorkflowTask | null) =>
  task?.status === 'queued' || task?.status === 'running';

export function AiInferencePanel({
  commandsManager,
  servicesManager,
}: AiInferencePanelProps): JSX.Element {
  const workflow = useAiWorkflowStore();
  const [isCurrentSeriesAiResult, setIsCurrentSeriesAiResult] = useState(false);
  const [selectedModelResultCount, setSelectedModelResultCount] = useState(0);

  const availableModels = workflow.models.length ? workflow.models : SUPPORTED_MODELS;
  const selectedModel = availableModels.find(model => model.name === workflow.selectedModelName);
  const availableTaskTypes = selectedModel?.taskTypes ?? ['segmentation'];
  const selectedRuntime = workflow.health?.runtimeServices.find(
    runtime => runtime.family === workflow.selectedModelName
  );
  const activeTask = workflow.tasks.find(task => isTaskActive(task)) ?? null;
  const canRunSelectedModel =
    !!selectedModel?.configured &&
    workflow.healthIndicatorState !== 'offline' &&
    (!selectedRuntime?.enabled || selectedRuntime.status === 'online') &&
    !isCurrentSeriesAiResult;
  const canStartInference =
    !workflow.isBusy && !activeTask && !!workflow.selectedModelName && canRunSelectedModel;
  const canClearSelectedModelResults =
    !workflow.isBusy && !activeTask && selectedModelResultCount > 0;
  const primaryActionLabel = getPrimaryActionLabel(
    workflow.isBusy,
    activeTask,
    canRunSelectedModel
  );

  const runCommand = async (commandName: string, options?: Record<string, unknown>) => {
    await commandsManager.runCommand(commandName, options);
  };

  useEffect(() => {
    void runCommand('aiInferenceCheckBackendHealth');
    const intervalId = window.setInterval(() => {
      void runCommand('aiInferenceCheckBackendHealth');
    }, HEALTH_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [commandsManager, workflow.backendUrl]);

  useEffect(() => {
    const { viewportGridService, displaySetService } =
      servicesManager.services as AppTypes.Services;

    if (!viewportGridService || !displaySetService) {
      setIsCurrentSeriesAiResult(false);
      setSelectedModelResultCount(0);
      return;
    }

    const getSelectedModelResultCount = () => {
      const modelPrefix = `${AI_RESULT_PREFIX} ${workflow.selectedModelName}`.trim().toUpperCase();
      const currentStudyInstanceUID = workflow.studyInstanceUID;
      const activeDisplaySets = displaySetService.getActiveDisplaySets?.() ?? [];
      const displaySetCount = activeDisplaySets.filter(displaySet => {
        const typedDisplaySet = displaySet as
          | {
              SeriesDescription?: string;
              displaySetLabel?: string;
              label?: string;
              StudyInstanceUID?: string;
              instances?: Array<{
                SeriesDescription?: string;
                StudyInstanceUID?: string;
              }>;
            }
          | undefined;
        const label =
          typedDisplaySet?.SeriesDescription ??
          typedDisplaySet?.displaySetLabel ??
          typedDisplaySet?.label ??
          typedDisplaySet?.instances?.[0]?.SeriesDescription ??
          '';
        const studyInstanceUID =
          typedDisplaySet?.StudyInstanceUID ??
          typedDisplaySet?.instances?.[0]?.StudyInstanceUID ??
          null;

        return (
          label.trim().toUpperCase().startsWith(modelPrefix) &&
          (!currentStudyInstanceUID || studyInstanceUID === currentStudyInstanceUID)
        );
      }).length;

      const renderedViewportResultCount =
        workflow.lastResult?.modelName === workflow.selectedModelName &&
        (!!workflow.studyInstanceUID
          ? workflow.lastResult?.reference.studyInstanceUID === workflow.studyInstanceUID
          : true) &&
        !!(workflow.renderedAnnotationIds.length || workflow.renderedSegmentationId)
          ? 1
          : 0;

      return displaySetCount + renderedViewportResultCount;
    };

    const getIsActiveViewportAiResult = () => {
      const activeViewportId =
        viewportGridService.getActiveViewportId?.() ??
        viewportGridService.getState().activeViewportId;

      if (!activeViewportId) {
        return false;
      }

      const displaySetInstanceUIDs =
        viewportGridService.getDisplaySetsUIDsForViewport?.(activeViewportId) ??
        viewportGridService.getState().viewports.get(activeViewportId)?.displaySetInstanceUIDs ??
        [];

      return displaySetInstanceUIDs.some(displaySetInstanceUID => {
        const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID) as
          | {
              SeriesDescription?: string;
              displaySetLabel?: string;
              label?: string;
              instances?: Array<{ SeriesDescription?: string }>;
            }
          | undefined;

        const label =
          displaySet?.SeriesDescription ??
          displaySet?.displaySetLabel ??
          displaySet?.label ??
          displaySet?.instances?.[0]?.SeriesDescription ??
          '';

        return isAiResultLabel(label);
      });
    };

    const syncActiveViewportState = () => {
      setIsCurrentSeriesAiResult(getIsActiveViewportAiResult());
      setSelectedModelResultCount(getSelectedModelResultCount());
    };

    syncActiveViewportState();

    const subscriptions = [
      viewportGridService.subscribe(
        viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
        syncActiveViewportState
      ),
      viewportGridService.subscribe(
        viewportGridService.EVENTS.GRID_STATE_CHANGED,
        syncActiveViewportState
      ),
      displaySetService.subscribe(
        displaySetService.EVENTS.DISPLAY_SETS_ADDED,
        syncActiveViewportState
      ),
      displaySetService.subscribe(
        displaySetService.EVENTS.DISPLAY_SETS_REMOVED,
        syncActiveViewportState
      ),
    ];

    return () => {
      subscriptions.forEach(subscription => subscription.unsubscribe());
    };
  }, [
    servicesManager,
    workflow.lastResult?.inferenceId,
    workflow.renderedAnnotationIds.length,
    workflow.renderedSegmentationId,
    workflow.selectedModelName,
  ]);

  const onTaskTypeChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    await runCommand('aiInferenceSetSelectedTaskType', {
      value: event.target.value as InferenceTaskType,
    });
  };

  const onTasksWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) {
      return;
    }

    const container = event.currentTarget;
    const hasHorizontalOverflow = container.scrollWidth > container.clientWidth + 1;

    if (!hasHorizontalOverflow) {
      return;
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

    if (!delta) {
      return;
    }

    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, container.scrollLeft + delta));

    if (Math.abs(nextScrollLeft - container.scrollLeft) < 1) {
      return;
    }

    event.preventDefault();
    container.scrollLeft = nextScrollLeft;
  };

  return (
    <div style={panelStyle}>
      <style>{TASKS_SHELL_CSS}</style>

      <div style={cardStyle}>
        <div style={inlineFieldStyle}>
          <label
            htmlFor="ai-backend-url"
            style={fieldLabelStyle}
          >
            AI Server
          </label>
          <input
            id="ai-backend-url"
            style={inputStyle}
            value={workflow.backendUrl}
            onChange={event =>
              void runCommand('aiInferenceSetBackendUrl', {
                value: event.target.value,
              })
            }
          />
        </div>
      </div>

      <div style={cardStyle}>
        <div style={stackedFieldGroupStyle}>
          <div style={compactFieldStyle}>
            <label
              htmlFor="ai-model-name"
              style={fieldLabelStyle}
            >
              Model
            </label>
            <select
              id="ai-model-name"
              style={inputStyle}
              value={workflow.selectedModelName}
              onChange={event =>
                void runCommand('aiInferenceSetSelectedModel', {
                  value: event.target.value,
                })
              }
            >
              {availableModels.map(model => (
                <option
                  key={model.name}
                  value={model.name}
                >
                  {model.name} ({model.family})
                </option>
              ))}
            </select>
          </div>

          <div style={compactFieldStyle}>
            <label
              htmlFor="ai-task-type"
              style={fieldLabelStyle}
            >
              Task Type
            </label>
            <select
              id="ai-task-type"
              style={inputStyle}
              value={workflow.selectedTaskType}
              onChange={onTaskTypeChange}
            >
              {availableTaskTypes.map(taskType => (
                <option
                  key={taskType}
                  value={taskType}
                >
                  {taskType}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.65rem' }}
        >
          <input
            type="checkbox"
            checked={workflow.runAsync}
            onChange={event =>
              void runCommand('aiInferenceSetRunAsync', {
                value: event.target.checked,
              })
            }
          />
          <span style={compactHintStyle}>Async job</span>
        </label>

        <div style={{ marginTop: '0.65rem' }}>
          <button
            type="button"
            style={{
              ...buttonStyle,
              width: '100%',
              opacity: canStartInference ? 1 : 0.68,
              background:
                activeTask?.status === 'running'
                  ? 'rgba(30, 64, 175, 0.9)'
                  : activeTask?.status === 'queued'
                    ? 'rgba(120, 53, 15, 0.92)'
                    : 'rgba(30, 41, 59, 0.95)',
            }}
            onClick={() => {
              if (canStartInference) {
                void runCommand('aiInferenceRunInference');
              }
            }}
            disabled={!canStartInference}
          >
            {primaryActionLabel}
          </button>
        </div>

        <div style={{ marginTop: '0.45rem' }}>
          <button
            type="button"
            style={{
              ...buttonStyle,
              width: '100%',
              opacity: canClearSelectedModelResults ? 1 : 0.68,
              background: 'rgba(15, 23, 42, 0.92)',
            }}
            onClick={() => {
              if (canClearSelectedModelResults) {
                void runCommand('aiInferenceClearSelectedModelResults');
              }
            }}
            disabled={!canClearSelectedModelResults}
          >
            Clear
          </button>
        </div>

        <div style={{ ...compactHintStyle, marginTop: '0.4rem' }}>
          {workflow.selectedModelName}: {selectedModelResultCount} visible current-study result
          {selectedModelResultCount === 1 ? '' : 's'}
        </div>

        {activeTask ? (
          <div style={{ ...compactHintStyle, marginTop: '0.45rem' }}>
            Active task:
            <span style={{ color: getTaskStatusColor(activeTask.status), fontWeight: 600 }}>
              {' '}
              {getTaskStatusLabel(activeTask.status)}
            </span>
          </div>
        ) : null}
      </div>

      <div style={{ ...cardStyle, flex: '1 1 auto', minHeight: 0 }}>
        <div
          style={{
            fontWeight: 600,
            marginBottom: '0.55rem',
            fontSize: '0.84rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.6rem',
          }}
        >
          <span>Tasks</span>
          <span style={compactHintStyle}>{workflow.tasks.length} items</span>
        </div>
        <div
          className={TASKS_SHELL_CLASS_NAME}
          onWheel={onTasksWheel}
          style={tableShellStyle}
        >
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={headerCellStyle}>Series</th>
                <th style={headerCellStyle}>Duration</th>
                <th style={headerCellStyle}>Model</th>
                <th style={headerCellStyle}>Status</th>
                <th style={headerCellStyle}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {workflow.tasks.length ? (
                workflow.tasks.map(task => (
                  <tr key={`${task.inferenceId}-${task.jobId}`}>
                    <td
                      style={bodyCellStyle}
                      title={formatSeriesNumber(task.seriesNumber)}
                    >
                      {formatSeriesNumber(task.seriesNumber)}
                    </td>
                    <td
                      style={{
                        ...bodyCellStyle,
                        ...numericCellStyle,
                        color: '#cbd5e1',
                      }}
                      title={formatDuration(task)}
                    >
                      {formatDuration(task)}
                    </td>
                    <td style={bodyCellStyle}>{task.modelName}</td>
                    <td
                      style={{
                        ...bodyCellStyle,
                        ...alignedCompactCellStyle,
                        color: getTaskStatusColor(task.status),
                        fontWeight: 600,
                      }}
                    >
                      {getTaskStatusLabel(task.status)}
                    </td>
                    <td style={{ ...bodyCellStyle, ...alignedCompactCellStyle }}>
                      {formatCompactTime(task.submittedAt)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    style={{ ...bodyCellStyle, color: '#94a3b8' }}
                  >
                    No tasks yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isCurrentSeriesAiResult ? (
        <div style={{ ...cardStyle, color: '#facc15' }}>
          Current active series is an AI result. Select an original source series before running
          inference.
        </div>
      ) : null}

      {workflow.error ? (
        <div style={{ ...cardStyle, color: '#fca5a5' }}>Error: {workflow.error}</div>
      ) : null}
    </div>
  );
}
