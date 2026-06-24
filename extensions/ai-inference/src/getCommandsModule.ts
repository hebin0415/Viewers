import { DicomMetadataStore, Types } from '@ohif/core';
import { AiInferenceApi } from './services/AiInferenceApi';
import { aiWorkflowStore } from './stores/AiWorkflowStore';
import { clearRelatedSegmentations } from './utils/clearAiSegmentationState';
import {
  clearRenderedAnnotations,
  clearRenderedSegmentation,
  renderInferenceResultToViewport,
} from './utils/renderInferenceResult';
import {
  activateOverlayDisplaySet,
  getPrimaryNonOverlayDisplaySetForViewport,
  getViewportDisplaySetUIDsAfterBulkRemoval,
  getViewportDisplaySetUIDsAfterRemoval,
} from './utils/derivedDisplaySetActivation';
import {
  DetectionVisualization,
  FocusedFindingDetails,
  HealthStatus,
  InferenceJobStatus,
  InferenceResult,
  InferenceTaskType,
  WorkflowTask,
} from './types';

const getApi = () => new AiInferenceApi(aiWorkflowStore.getState().backendUrl);
const ASYNC_JOB_POLL_INTERVAL_MS = 1500;
const RECENTLY_OFFLINE_WINDOW_MS = 6000;
const DERIVED_DISPLAY_SET_RETRY_COUNT = 8;
const DERIVED_DISPLAY_SET_RETRY_DELAY_MS = 250;
const DERIVED_SERIES_REFRESH_RETRY_COUNT = 20;
const DERIVED_SERIES_REFRESH_RETRY_DELAY_MS = 1000;
const AI_RESULT_PREFIX = 'AI |';
const MAX_RECENT_RESULTS = 24;

type AiWorkflowState = ReturnType<typeof aiWorkflowStore.getState>;

type ActiveViewportReference = {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  isAiResult: boolean;
  seriesNumber?: number | string;
  seriesLabel: string;
  viewportId: string;
};

type ResultActionOptions = {
  result?: InferenceResult;
  silent?: boolean;
};

type StoredSeriesMetadata = {
  SeriesDescription?: string;
  instances?: Array<Record<string, unknown>>;
};

const getIsoNow = () => new Date().toISOString();

const delay = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

const isAiResultLabel = (value?: string | null) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .startsWith(AI_RESULT_PREFIX.toUpperCase());

const getTaskStatusLabel = (status: InferenceJobStatus) => {
  switch (status) {
    case 'queued':
      return 'waiting';
    case 'completed':
      return 'done';
    default:
      return status;
  }
};

const getDisplaySetLabel = (
  displaySet:
    | {
        SeriesDescription?: string;
        displaySetLabel?: string;
        label?: string;
        instances?: Array<{ SeriesDescription?: string }>;
      }
    | undefined
) =>
  displaySet?.SeriesDescription ??
  displaySet?.displaySetLabel ??
  displaySet?.label ??
  displaySet?.instances?.[0]?.SeriesDescription ??
  '';

const getDisplaySetStudyInstanceUID = (
  displaySet:
    | {
        StudyInstanceUID?: string;
        instances?: Array<{ StudyInstanceUID?: string }>;
      }
    | undefined
) => displaySet?.StudyInstanceUID ?? displaySet?.instances?.[0]?.StudyInstanceUID ?? null;

const getDisplaySetSeriesInstanceUID = (
  displaySet:
    | {
        SeriesInstanceUID?: string;
        instances?: Array<{ SeriesInstanceUID?: string }>;
      }
    | undefined
) => displaySet?.SeriesInstanceUID ?? displaySet?.instances?.[0]?.SeriesInstanceUID ?? null;

const getSeriesMetadataLabel = (
  studyInstanceUID?: string | null,
  seriesInstanceUID?: string | null
) => {
  if (!studyInstanceUID || !seriesInstanceUID) {
    return '';
  }

  const seriesMetadata = DicomMetadataStore.getSeries(studyInstanceUID, seriesInstanceUID) as
    | StoredSeriesMetadata
    | undefined;

  return (
    seriesMetadata?.SeriesDescription ??
    (seriesMetadata?.instances?.[0]?.SeriesDescription as string | undefined) ??
    ''
  );
};

const isDisplaySetForAiModel = (
  displaySet:
    | {
        SeriesDescription?: string;
        displaySetLabel?: string;
        label?: string;
        instances?: Array<{ SeriesDescription?: string }>;
      }
    | undefined,
  modelName: string
) =>
  getDisplaySetLabel(displaySet)
    .trim()
    .toUpperCase()
    .startsWith(`${AI_RESULT_PREFIX} ${modelName}`.trim().toUpperCase());

const getDurationLabel = (startedAt?: string | null, completedAt?: string | null) => {
  if (!startedAt) {
    return '';
  }

  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(completedAt ?? getIsoNow()).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return '';
  }

  const totalSeconds = Math.round((endMs - startMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const buildCompletionMessage = (
  task: WorkflowTask,
  result: InferenceResult,
  displayVerb: string
) => {
  const durationLabel = getDurationLabel(task.startedAt ?? task.submittedAt, result.completedAt);
  const durationSuffix = durationLabel ? ` (${durationLabel})` : '';
  return `${task.seriesLabel} · ${result.modelName} ${getTaskStatusLabel(result.status)}${durationSuffix}. ${displayVerb}`;
};

const getIndicatorStateFromHealth = (
  health: HealthStatus
): AiWorkflowState['healthIndicatorState'] =>
  health.status === 'ok' && health.onlineRuntimeCount === health.enabledRuntimeCount
    ? 'online'
    : 'degraded';

const getOfflineIndicatorState = (
  lastHealthyAt: string | null
): AiWorkflowState['healthIndicatorState'] => {
  if (!lastHealthyAt) {
    return 'offline';
  }

  const lastHealthyMs = new Date(lastHealthyAt).getTime();
  if (!Number.isNaN(lastHealthyMs) && Date.now() - lastHealthyMs <= RECENTLY_OFFLINE_WINDOW_MS) {
    return 'recentlyOffline';
  }

  return 'offline';
};

const parseFindingText = (findingText: string, referencedSOPInstanceUID?: string | null) => {
  const trimmedText = String(findingText ?? '').trim();

  if (!trimmedText) {
    return null;
  }

  const segments = trimmedText
    .split('|')
    .map(segment => segment.trim())
    .filter(Boolean);
  const legacyMatch = trimmedText.match(
    /^(.*?)\s+confidence=([-+]?\d*\.?\d+%?)\s+bbox=\(([-+]?\d*\.?\d+),([-+]?\d*\.?\d+),([-+]?\d*\.?\d+),([-+]?\d*\.?\d+)\)\s+slice=(\d+)/i
  );

  if (legacyMatch) {
    const confidenceRaw = legacyMatch[2].includes('%') ? legacyMatch[2] : `${legacyMatch[2]}%`;
    const confidenceValue = Number.parseFloat(legacyMatch[2].replace('%', ''));
    const sliceIndex = Number.parseInt(legacyMatch[7], 10);
    const x = Number.parseFloat(legacyMatch[3]);
    const y = Number.parseFloat(legacyMatch[4]);
    const width = Number.parseFloat(legacyMatch[5]);
    const height = Number.parseFloat(legacyMatch[6]);
    const inferredSite = (() => {
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      const horizontal = centerX < 0.33 ? 'left' : centerX > 0.67 ? 'right' : 'central';
      const vertical = centerY < 0.33 ? 'upper' : centerY > 0.67 ? 'lower' : 'mid';
      return `${horizontal}-${vertical} field`;
    })();
    const assessment =
      confidenceValue >= 75
        ? 'high suspicion'
        : confidenceValue >= 40
          ? 'moderate suspicion'
          : 'low suspicion';

    const detection: DetectionVisualization = {
      id: `sr-finding-${referencedSOPInstanceUID ?? legacyMatch[1]}-${sliceIndex}`,
      label: legacyMatch[1].trim() || 'Finding',
      confidence: Number.isFinite(confidenceValue)
        ? legacyMatch[2].includes('%')
          ? confidenceValue / 100
          : confidenceValue
        : 0,
      x,
      y,
      width,
      height,
      sliceIndex: Number.isFinite(sliceIndex) ? sliceIndex : 0,
      anatomicalSite: inferredSite,
      lesionType: legacyMatch[1].trim() || 'Finding',
      sizeText: `${(width * 100).toFixed(1)}% x ${(height * 100).toFixed(1)}%`,
      assessment,
      annotationText: trimmedText,
      referencedSOPInstanceUID: referencedSOPInstanceUID ?? null,
    };

    const focusedFinding: FocusedFindingDetails = {
      label: detection.label,
      anatomicalSite: detection.anatomicalSite ?? 'unspecified',
      lesionType: detection.lesionType ?? detection.label,
      sizeText: detection.sizeText ?? 'unspecified',
      assessment,
      confidenceText: confidenceRaw,
      sliceText: `slice ${detection.sliceIndex ?? 0}`,
      referencedSOPInstanceUID: referencedSOPInstanceUID ?? null,
    };

    return { detection, focusedFinding };
  }

  const label = segments.shift() ?? 'Finding';
  const fieldMap = new Map<string, string>();

  segments.forEach(segment => {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }

    const key = segment.slice(0, separatorIndex).trim().toLowerCase();
    const value = segment.slice(separatorIndex + 1).trim();
    if (key) {
      fieldMap.set(key, value);
    }
  });

  const bboxValue = fieldMap.get('bbox');
  const bboxMatch = bboxValue?.match(
    /^\(([-+]?\d*\.?\d+),([-+]?\d*\.?\d+),([-+]?\d*\.?\d+),([-+]?\d*\.?\d+)\)$/
  );

  if (!bboxMatch) {
    return null;
  }

  const sliceIndex = Number.parseInt(fieldMap.get('slice') ?? '0', 10);
  const confidenceRaw = fieldMap.get('confidence') ?? '0%';
  const confidenceNumeric = Number.parseFloat(confidenceRaw.replace('%', ''));

  const detection: DetectionVisualization = {
    id: `sr-finding-${referencedSOPInstanceUID ?? label}-${sliceIndex}`,
    label,
    confidence: Number.isFinite(confidenceNumeric) ? confidenceNumeric / 100 : 0,
    x: Number.parseFloat(bboxMatch[1]),
    y: Number.parseFloat(bboxMatch[2]),
    width: Number.parseFloat(bboxMatch[3]),
    height: Number.parseFloat(bboxMatch[4]),
    sliceIndex: Number.isFinite(sliceIndex) ? sliceIndex : 0,
    anatomicalSite: fieldMap.get('site') ?? null,
    lesionType: fieldMap.get('type') ?? null,
    sizeText: fieldMap.get('size') ?? null,
    assessment: fieldMap.get('assessment') ?? null,
    annotationText: trimmedText,
    referencedSOPInstanceUID: referencedSOPInstanceUID ?? null,
  };

  const focusedFinding: FocusedFindingDetails = {
    label,
    anatomicalSite: detection.anatomicalSite ?? 'unspecified',
    lesionType: detection.lesionType ?? label,
    sizeText: detection.sizeText ?? 'unspecified',
    assessment: detection.assessment ?? 'unspecified',
    confidenceText: confidenceRaw,
    sliceText: `slice ${detection.sliceIndex ?? 0}`,
    referencedSOPInstanceUID: referencedSOPInstanceUID ?? null,
  };

  return { detection, focusedFinding };
};

const buildPatientReport = (results: InferenceResult[]) => {
  if (!results.length) {
    return null;
  }

  const summaries = results
    .map(result => {
      const detections = result.payload.visualizations?.detections ?? [];
      const segmentation = result.payload.visualizations?.segmentation;
      const storageMode = result.payload.storage?.mode ?? 'overlay-only';
      const findingSummary = detections.length
        ? detections
            .map(
              detection =>
                `${detection.label} (${detection.anatomicalSite ?? 'site n/a'}, ${Math.round(
                  detection.confidence * 100
                )}%, ${detection.assessment ?? 'assessment n/a'})`
            )
            .join('; ')
        : segmentation
          ? `${segmentation.label} segmentation ready`
          : 'no direct finding payload';

      return [
        `${result.modelName} ${result.taskType}`,
        `status=${result.status}`,
        `storage=${storageMode}`,
        `summary=${result.payload.summary}`,
        `findings=${findingSummary}`,
      ].join(' | ');
    })
    .join('\n');

  return ['Patient AI Report', summaries].join('\n');
};

const getCommandsModule = ({
  servicesManager,
  commandsManager,
  extensionManager,
}: Types.Extensions.ExtensionParams): Types.Extensions.CommandsModule => {
  const {
    uiNotificationService,
    viewportGridService,
    displaySetService,
    hangingProtocolService,
    segmentationService,
  } = servicesManager.services as AppTypes.Services;

  const activePollingJobIds = new Set<string>();
  let healthCheckInFlight = false;
  let modelsLoadInFlight = false;

  const notify = (
    title: string,
    message: string,
    type: 'success' | 'warning' | 'info' | 'error'
  ) => {
    uiNotificationService.show({
      title,
      message,
      type,
    });
  };

  const getActiveDataSource = () =>
    extensionManager.getActiveDataSource?.()?.[0] as
      | {
          retrieve?: {
            series?: {
              metadata?: (options: {
                StudyInstanceUID: string;
                filters?: { seriesInstanceUID?: string[] };
              }) => Promise<unknown>;
            };
          };
          deleteStudyMetadataPromise?: (studyMetadataKey: string) => void;
          getConfig?: () => { name?: string };
        }
      | undefined;

  const getActiveViewportReference = (): ActiveViewportReference | null => {
    const viewportId =
      viewportGridService.getActiveViewportId?.() ??
      viewportGridService.getState().activeViewportId;

    if (!viewportId) {
      return null;
    }

    const displaySetInstanceUIDs =
      viewportGridService.getDisplaySetsUIDsForViewport?.(viewportId) ??
      viewportGridService.getState().viewports.get(viewportId)?.displaySetInstanceUIDs ??
      [];

    for (const displaySetInstanceUID of displaySetInstanceUIDs) {
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID) as
        | {
            Modality?: string;
            StudyInstanceUID?: string;
            SeriesInstanceUID?: string;
            SeriesNumber?: number | string;
            SeriesDescription?: string;
            displaySetLabel?: string;
            instances?: Array<{
              StudyInstanceUID?: string;
              SeriesInstanceUID?: string;
              SeriesNumber?: number | string;
              SeriesDescription?: string;
            }>;
            measurements?: Array<{ displaySetInstanceUID?: string }>;
          }
        | undefined;

      if (!displaySet) {
        continue;
      }

      const resolvedDisplaySet =
        displaySet.Modality === 'SR' && displaySet.measurements?.[0]?.displaySetInstanceUID
          ? (displaySetService.getDisplaySetByUID(
              displaySet.measurements[0].displaySetInstanceUID
            ) as
              | {
                  StudyInstanceUID?: string;
                  SeriesInstanceUID?: string;
                  SeriesNumber?: number | string;
                  SeriesDescription?: string;
                  displaySetLabel?: string;
                  instances?: Array<{
                    StudyInstanceUID?: string;
                    SeriesInstanceUID?: string;
                    SeriesNumber?: number | string;
                    SeriesDescription?: string;
                  }>;
                }
              | undefined)
          : displaySet;

      const studyInstanceUID =
        resolvedDisplaySet?.StudyInstanceUID ??
        resolvedDisplaySet?.instances?.[0]?.StudyInstanceUID;
      const seriesInstanceUID =
        resolvedDisplaySet?.SeriesInstanceUID ??
        resolvedDisplaySet?.instances?.[0]?.SeriesInstanceUID;
      const seriesNumber =
        resolvedDisplaySet?.SeriesNumber ?? resolvedDisplaySet?.instances?.[0]?.SeriesNumber;
      const metadataSeriesLabel = getSeriesMetadataLabel(studyInstanceUID, seriesInstanceUID);
      const seriesLabel =
        (metadataSeriesLabel || resolvedDisplaySet?.SeriesDescription) ??
        resolvedDisplaySet?.displaySetLabel ??
        resolvedDisplaySet?.instances?.[0]?.SeriesDescription ??
        seriesInstanceUID ??
        'Current Series';

      if (studyInstanceUID && seriesInstanceUID) {
        return {
          studyInstanceUID,
          seriesInstanceUID,
          isAiResult: isAiResultLabel(seriesLabel),
          seriesNumber,
          seriesLabel,
          viewportId,
        };
      }
    }

    return null;
  };

  const upsertTask = (
    taskPatch: Partial<WorkflowTask> &
      Pick<WorkflowTask, 'inferenceId'> &
      Partial<
        Pick<
          WorkflowTask,
          | 'jobId'
          | 'modelName'
          | 'taskType'
          | 'viewportId'
          | 'seriesNumber'
          | 'seriesLabel'
          | 'status'
          | 'submittedAt'
        >
      >
  ) => {
    aiWorkflowStore.update(current => {
      const existingIndex = current.tasks.findIndex(
        task =>
          task.inferenceId === taskPatch.inferenceId ||
          (!!taskPatch.jobId && task.jobId === taskPatch.jobId)
      );

      const existingTask = existingIndex >= 0 ? current.tasks[existingIndex] : null;
      const nextTask: WorkflowTask = {
        jobId: taskPatch.jobId ?? existingTask?.jobId ?? `pending-${taskPatch.inferenceId}`,
        inferenceId: taskPatch.inferenceId,
        modelName: taskPatch.modelName ?? existingTask?.modelName ?? 'unknown',
        taskType: taskPatch.taskType ?? existingTask?.taskType ?? 'segmentation',
        viewportId: taskPatch.viewportId ?? existingTask?.viewportId ?? null,
        seriesNumber: taskPatch.seriesNumber ?? existingTask?.seriesNumber ?? null,
        seriesLabel: taskPatch.seriesLabel ?? existingTask?.seriesLabel ?? 'Current Series',
        status: taskPatch.status ?? existingTask?.status ?? 'queued',
        submittedAt: taskPatch.submittedAt ?? existingTask?.submittedAt ?? getIsoNow(),
        startedAt:
          taskPatch.startedAt !== undefined
            ? taskPatch.startedAt
            : (existingTask?.startedAt ?? null),
        completedAt:
          taskPatch.completedAt !== undefined
            ? taskPatch.completedAt
            : (existingTask?.completedAt ?? null),
        error: taskPatch.error !== undefined ? taskPatch.error : (existingTask?.error ?? null),
      };

      const tasks = [...current.tasks];
      if (existingIndex >= 0) {
        tasks[existingIndex] = nextTask;
      } else {
        tasks.unshift(nextTask);
      }

      tasks.sort(
        (left, right) =>
          new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
      );

      return { tasks };
    });
  };

  const getTaskByInferenceId = (inferenceId: string) =>
    aiWorkflowStore.getState().tasks.find(task => task.inferenceId === inferenceId) ?? null;

  const upsertRecentResult = (result: InferenceResult) => {
    aiWorkflowStore.update(current => {
      const recentResults = [
        result,
        ...current.recentResults.filter(item => item.inferenceId !== result.inferenceId),
      ].slice(0, MAX_RECENT_RESULTS);

      return {
        recentResults,
        lastResult: result,
      };
    });
  };

  const isActiveViewportAiResult = () => {
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

  const findViewportIdForSeries = (seriesInstanceUID?: string | null) => {
    if (!seriesInstanceUID) {
      return null;
    }

    const viewports = viewportGridService.getState().viewports;

    for (const [viewportId, viewport] of viewports.entries()) {
      const displaySetInstanceUIDs = viewport?.displaySetInstanceUIDs ?? [];

      for (const displaySetInstanceUID of displaySetInstanceUIDs) {
        const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID) as
          | {
              SeriesInstanceUID?: string;
              instances?: Array<{ SeriesInstanceUID?: string }>;
            }
          | undefined;

        const currentSeriesInstanceUID =
          displaySet?.SeriesInstanceUID ?? displaySet?.instances?.[0]?.SeriesInstanceUID;

        if (currentSeriesInstanceUID === seriesInstanceUID) {
          return viewportId;
        }
      }
    }

    return null;
  };

  const resolveViewportIdForResult = (result: InferenceResult) => {
    const task = getTaskByInferenceId(result.inferenceId);
    const taskViewportId = task?.viewportId;
    const knownViewport = taskViewportId
      ? viewportGridService.getState().viewports.get(taskViewportId)
      : null;

    if (knownViewport) {
      return taskViewportId ?? null;
    }

    return (
      findViewportIdForSeries(result.reference.seriesInstanceUID) ??
      getActiveViewportReference()?.viewportId ??
      null
    );
  };

  const getReferencedSourceSeriesInstanceUID = (
    displaySet:
      | {
          SeriesInstanceUID?: string;
          referencedSeriesInstanceUID?: string;
          referencedDisplaySetInstanceUID?: string;
        }
      | undefined
  ) => {
    if (displaySet?.referencedSeriesInstanceUID) {
      return displaySet.referencedSeriesInstanceUID;
    }

    const seriesInstanceUID = getDisplaySetSeriesInstanceUID(displaySet);
    if (!seriesInstanceUID) {
      return null;
    }

    const workflow = aiWorkflowStore.getState();
    return workflow.lastResult?.payload.storage?.derivedSeriesInstanceUID === seriesInstanceUID
      ? (workflow.lastResult.reference.seriesInstanceUID ?? null)
      : null;
  };

  const removeDisplaySetFromViewports = async (displaySetInstanceUID: string) => {
    const targetDisplaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID) as
      | {
          displaySetInstanceUID?: string;
          SeriesInstanceUID?: string;
          referencedSeriesInstanceUID?: string;
          referencedDisplaySetInstanceUID?: string;
          isOverlayDisplaySet?: boolean;
        }
      | undefined;
    const viewports = viewportGridService.getState().viewports;

    for (const [viewportId, viewport] of viewports.entries()) {
      const displaySetInstanceUIDs = viewport?.displaySetInstanceUIDs ?? [];

      if (!displaySetInstanceUIDs.includes(displaySetInstanceUID)) {
        continue;
      }

      const remainingDisplaySetInstanceUIDs = getViewportDisplaySetUIDsAfterRemoval(
        displaySetService,
        viewportGridService,
        {
          displaySetInstanceUID,
          referencedDisplaySetInstanceUID: targetDisplaySet?.referencedDisplaySetInstanceUID,
          referencedSeriesInstanceUID:
            getReferencedSourceSeriesInstanceUID(targetDisplaySet) ?? undefined,
          isOverlayDisplaySet: targetDisplaySet?.isOverlayDisplaySet,
        },
        viewportId
      );

      await viewportGridService.setDisplaySetsForViewport({
        viewportId,
        displaySetInstanceUIDs: remainingDisplaySetInstanceUIDs,
      });
    }
  };

  const removeDisplaySetsFromViewports = async (
    displaySetInstanceUIDsToRemove: string[],
    reference?: {
      referencedDisplaySetInstanceUID?: string;
      referencedSeriesInstanceUID?: string;
      isOverlayDisplaySet?: boolean;
    }
  ) => {
    if (!displaySetInstanceUIDsToRemove.length) {
      return;
    }

    const displaySetUIDsToRemove = new Set(displaySetInstanceUIDsToRemove);
    const viewports = viewportGridService.getState().viewports;

    for (const [viewportId, viewport] of viewports.entries()) {
      const viewportDisplaySetInstanceUIDs = viewport?.displaySetInstanceUIDs ?? [];

      if (!viewportDisplaySetInstanceUIDs.some(uid => displaySetUIDsToRemove.has(uid))) {
        continue;
      }

      const remainingDisplaySetInstanceUIDs = getViewportDisplaySetUIDsAfterBulkRemoval(
        displaySetService,
        viewportGridService,
        {
          displaySetInstanceUIDs: displaySetInstanceUIDsToRemove,
          referencedDisplaySetInstanceUID: reference?.referencedDisplaySetInstanceUID,
          referencedSeriesInstanceUID: reference?.referencedSeriesInstanceUID,
          isOverlayDisplaySet: reference?.isOverlayDisplaySet,
        },
        viewportId
      );

      await viewportGridService.setDisplaySetsForViewport({
        viewportId,
        displaySetInstanceUIDs: remainingDisplaySetInstanceUIDs,
      });
    }
  };

  const getViewportIdsContainingDisplaySets = (displaySetInstanceUIDs: string[]) => {
    if (!displaySetInstanceUIDs.length) {
      return [] as string[];
    }

    const removableUIDs = new Set(displaySetInstanceUIDs);

    return [...viewportGridService.getState().viewports.entries()]
      .filter(([, viewport]) =>
        (viewport?.displaySetInstanceUIDs ?? []).some(uid => removableUIDs.has(uid))
      )
      .map(([viewportId]) => viewportId);
  };

  const ensureSourceDisplaySetAvailable = (
    studyInstanceUID?: string | null,
    referencedDisplaySetInstanceUID?: string,
    referencedSeriesInstanceUID?: string
  ) => {
    if (referencedDisplaySetInstanceUID) {
      const referencedDisplaySet = displaySetService.getDisplaySetByUID(
        referencedDisplaySetInstanceUID
      ) as
        | {
            displaySetInstanceUID?: string;
          }
        | undefined;

      if (referencedDisplaySet?.displaySetInstanceUID) {
        return referencedDisplaySet;
      }
    }

    if (!studyInstanceUID || !referencedSeriesInstanceUID) {
      return null;
    }

    const existingDisplaySets = displaySetService.getDisplaySetsForSeries(
      referencedSeriesInstanceUID
    ) as
      | Array<{
          displaySetInstanceUID?: string;
        }>
      | undefined;

    if (existingDisplaySets?.length) {
      return existingDisplaySets[0];
    }

    const seriesMetadata = DicomMetadataStore.getSeries(
      studyInstanceUID,
      referencedSeriesInstanceUID
    ) as StoredSeriesMetadata | undefined;

    if (!seriesMetadata?.instances?.length) {
      return null;
    }

    displaySetService.makeDisplaySets(seriesMetadata.instances, { madeInClient: true });

    return (displaySetService.getDisplaySetsForSeries(referencedSeriesInstanceUID)?.[0] ??
      null) as {
      displaySetInstanceUID?: string;
    } | null;
  };

  const restoreReferencedSourceDisplaySet = async (
    viewportIds: string[],
    options: {
      studyInstanceUID?: string | null;
      referencedDisplaySetInstanceUID?: string;
      referencedSeriesInstanceUID?: string;
    }
  ) => {
    const sourceDisplaySet = ensureSourceDisplaySetAvailable(
      options.studyInstanceUID,
      options.referencedDisplaySetInstanceUID,
      options.referencedSeriesInstanceUID
    ) as {
      displaySetInstanceUID?: string;
    } | null;

    if (!sourceDisplaySet?.displaySetInstanceUID) {
      return;
    }

    const targetViewportIds = viewportIds.length
      ? viewportIds
      : [
          viewportGridService.getActiveViewportId?.() ??
            viewportGridService.getState().activeViewportId,
        ].filter((viewportId): viewportId is string => !!viewportId);

    for (const viewportId of targetViewportIds) {
      await viewportGridService.setDisplaySetsForViewport({
        viewportId,
        displaySetInstanceUIDs: [sourceDisplaySet.displaySetInstanceUID],
      });
    }
  };

  const invalidateStudyMetadataCache = (studyInstanceUID?: string | null) => {
    if (!studyInstanceUID) {
      return;
    }

    const dataSource = getActiveDataSource();
    const dataSourceName = dataSource?.getConfig?.()?.name;
    dataSource?.deleteStudyMetadataPromise?.(studyInstanceUID);

    if (dataSourceName) {
      dataSource?.deleteStudyMetadataPromise?.(`${dataSourceName}:${studyInstanceUID}`);
    }
  };

  const removeSeriesFromSession = async (
    seriesInstanceUID: string,
    { silent = false }: { silent?: boolean } = {}
  ) => {
    const displaySets = displaySetService.getDisplaySetsForSeries(seriesInstanceUID) as
      | Array<{
          displaySetInstanceUID?: string;
          StudyInstanceUID?: string;
          SeriesInstanceUID?: string;
          SeriesDescription?: string;
          displaySetLabel?: string;
          label?: string;
          instances?: Array<{
            StudyInstanceUID?: string;
            SeriesInstanceUID?: string;
            SeriesDescription?: string;
          }>;
        }>
      | undefined;

    if (!displaySets?.length) {
      if (!silent) {
        notify('AI Inference', 'Series is no longer available in the current session', 'warning');
      }

      return false;
    }

    const removableDisplaySetInstanceUIDs = displaySets
      .map(displaySet => displaySet?.displaySetInstanceUID)
      .filter((displaySetInstanceUID): displaySetInstanceUID is string => !!displaySetInstanceUID);
    const affectedViewportIds = getViewportIdsContainingDisplaySets(
      removableDisplaySetInstanceUIDs
    );

    const referencedDisplaySetInstanceUID = displaySets.find(
      displaySet =>
        !!(displaySet as { referencedDisplaySetInstanceUID?: string } | undefined)
          ?.referencedDisplaySetInstanceUID
    ) as ({ referencedDisplaySetInstanceUID?: string } & Record<string, unknown>) | undefined;

    const referencedSeriesInstanceUID =
      displaySets
        .map(displaySet =>
          getReferencedSourceSeriesInstanceUID(
            displaySet as
              | {
                  SeriesInstanceUID?: string;
                  referencedSeriesInstanceUID?: string;
                  referencedDisplaySetInstanceUID?: string;
                }
              | undefined
          )
        )
        .find(Boolean) ?? undefined;

    await removeDisplaySetsFromViewports(removableDisplaySetInstanceUIDs, {
      referencedDisplaySetInstanceUID:
        referencedDisplaySetInstanceUID?.referencedDisplaySetInstanceUID,
      referencedSeriesInstanceUID,
      isOverlayDisplaySet: true,
    });

    const removedSegmentationIds = clearRelatedSegmentations(
      displaySets,
      segmentationService,
      displaySetService
    );

    for (const displaySetInstanceUID of removableDisplaySetInstanceUIDs) {
      displaySetService.deleteDisplaySet(displaySetInstanceUID);
    }

    const displaySet = displaySets[0];
    const workflow = aiWorkflowStore.getState();
    const studyInstanceUID = getDisplaySetStudyInstanceUID(displaySet);
    const displayLabel = getDisplaySetLabel(displaySet) || seriesInstanceUID || 'Series';
    const isLastDerivedSeries =
      workflow.lastResult?.payload.storage?.derivedSeriesInstanceUID === seriesInstanceUID;

    await restoreReferencedSourceDisplaySet(affectedViewportIds, {
      studyInstanceUID,
      referencedDisplaySetInstanceUID:
        referencedDisplaySetInstanceUID?.referencedDisplaySetInstanceUID,
      referencedSeriesInstanceUID,
    });

    aiWorkflowStore.update(current => ({
      lastResult: isLastDerivedSeries ? null : current.lastResult,
      renderedSegmentationId:
        current.renderedSegmentationId &&
        removedSegmentationIds.includes(current.renderedSegmentationId)
          ? null
          : current.renderedSegmentationId,
      studyInstanceUID:
        current.studyInstanceUID &&
        studyInstanceUID &&
        current.studyInstanceUID === studyInstanceUID
          ? ''
          : current.studyInstanceUID,
      seriesInstanceUID:
        current.seriesInstanceUID && current.seriesInstanceUID === seriesInstanceUID
          ? ''
          : current.seriesInstanceUID,
      lastAction: `${displayLabel} removed from the current session`,
      error: null,
    }));

    if (!silent) {
      notify('AI Inference', `${displayLabel} removed from the current session`, 'success');
    }

    return true;
  };

  const removeDisplaySetFromSession = async (
    displaySetInstanceUID: string,
    { silent = false }: { silent?: boolean } = {}
  ) => {
    const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID) as
      | {
          displaySetInstanceUID?: string;
          StudyInstanceUID?: string;
          SeriesInstanceUID?: string;
          SeriesDescription?: string;
          displaySetLabel?: string;
          label?: string;
          instances?: Array<{
            StudyInstanceUID?: string;
            SeriesInstanceUID?: string;
            SeriesDescription?: string;
          }>;
        }
      | undefined;

    if (!displaySet) {
      if (!silent) {
        notify('AI Inference', 'Series is no longer available in the current session', 'warning');
      }

      return false;
    }

    const seriesInstanceUID = getDisplaySetSeriesInstanceUID(displaySet);
    if (seriesInstanceUID) {
      return removeSeriesFromSession(seriesInstanceUID, { silent });
    }

    const affectedViewportIds = getViewportIdsContainingDisplaySets([displaySetInstanceUID]);
    await removeDisplaySetFromViewports(displaySetInstanceUID);
    const removedSegmentationIds = clearRelatedSegmentations(
      [displaySet],
      segmentationService,
      displaySetService
    );
    displaySetService.deleteDisplaySet(displaySetInstanceUID);

    const workflow = aiWorkflowStore.getState();
    const studyInstanceUID = getDisplaySetStudyInstanceUID(displaySet);
    const displayLabel = getDisplaySetLabel(displaySet) || seriesInstanceUID || 'Series';
    const isLastDerivedSeries =
      !!seriesInstanceUID &&
      workflow.lastResult?.payload.storage?.derivedSeriesInstanceUID === seriesInstanceUID;

    await restoreReferencedSourceDisplaySet(affectedViewportIds, {
      studyInstanceUID,
      referencedDisplaySetInstanceUID: (displaySet as { referencedDisplaySetInstanceUID?: string })
        ?.referencedDisplaySetInstanceUID,
      referencedSeriesInstanceUID:
        getReferencedSourceSeriesInstanceUID(
          displaySet as
            | {
                SeriesInstanceUID?: string;
                referencedSeriesInstanceUID?: string;
                referencedDisplaySetInstanceUID?: string;
              }
            | undefined
        ) ?? undefined,
    });

    aiWorkflowStore.update(current => ({
      lastResult: isLastDerivedSeries ? null : current.lastResult,
      renderedSegmentationId:
        current.renderedSegmentationId &&
        removedSegmentationIds.includes(current.renderedSegmentationId)
          ? null
          : current.renderedSegmentationId,
      studyInstanceUID:
        current.studyInstanceUID &&
        studyInstanceUID &&
        current.studyInstanceUID === studyInstanceUID
          ? ''
          : current.studyInstanceUID,
      seriesInstanceUID:
        current.seriesInstanceUID &&
        seriesInstanceUID &&
        current.seriesInstanceUID === seriesInstanceUID
          ? ''
          : current.seriesInstanceUID,
      lastAction: `${displayLabel} removed from the current session`,
      error: null,
    }));

    if (!silent) {
      notify('AI Inference', `${displayLabel} removed from the current session`, 'success');
    }

    return true;
  };

  const ensureDerivedDisplaySetMaterialized = (
    studyInstanceUID: string,
    derivedSeriesInstanceUID: string
  ) => {
    const existingDisplaySets =
      displaySetService.getDisplaySetsForSeries(derivedSeriesInstanceUID) ?? [];

    if (existingDisplaySets.length) {
      return existingDisplaySets[0];
    }

    const seriesMetadata = DicomMetadataStore.getSeries(
      studyInstanceUID,
      derivedSeriesInstanceUID
    ) as StoredSeriesMetadata | undefined;

    if (!seriesMetadata?.instances?.length) {
      return null;
    }

    displaySetService.makeDisplaySets(seriesMetadata.instances, { madeInClient: true });

    return displaySetService.getDisplaySetsForSeries(derivedSeriesInstanceUID)?.[0] ?? null;
  };

  const waitForDerivedDisplaySet = async (
    studyInstanceUID: string,
    derivedSeriesInstanceUID: string,
    dataSource: ReturnType<typeof getActiveDataSource>,
    refreshMetadata: (options: {
      StudyInstanceUID: string;
      filters?: { seriesInstanceUID?: string[] };
    }) => Promise<unknown>
  ) => {
    for (let attempt = 0; attempt < DERIVED_SERIES_REFRESH_RETRY_COUNT; attempt += 1) {
      const existingDisplaySet = ensureDerivedDisplaySetMaterialized(
        studyInstanceUID,
        derivedSeriesInstanceUID
      );

      if (existingDisplaySet) {
        return existingDisplaySet;
      }

      const dataSourceName = dataSource?.getConfig?.()?.name;
      dataSource?.deleteStudyMetadataPromise?.(studyInstanceUID);
      if (dataSourceName) {
        dataSource?.deleteStudyMetadataPromise?.(`${dataSourceName}:${studyInstanceUID}`);
      }

      const shouldRefreshWholeStudy = attempt > 0 && attempt % 4 === 0;

      await refreshMetadata(
        shouldRefreshWholeStudy
          ? {
              StudyInstanceUID: studyInstanceUID,
            }
          : {
              StudyInstanceUID: studyInstanceUID,
              filters: {
                seriesInstanceUID: [derivedSeriesInstanceUID],
              },
            }
      );

      const refreshedDisplaySet = ensureDerivedDisplaySetMaterialized(
        studyInstanceUID,
        derivedSeriesInstanceUID
      );

      if (refreshedDisplaySet) {
        return refreshedDisplaySet;
      }

      await delay(DERIVED_SERIES_REFRESH_RETRY_DELAY_MS);
    }

    throw new Error(
      `Derived series ${derivedSeriesInstanceUID} is not available yet. The series metadata did not finish refreshing in time.`
    );
  };

  const activateDerivedDisplaySet = async (
    derivedSeriesInstanceUID: string,
    viewportId: string
  ): Promise<boolean> => {
    let targetDisplaySet: any = null;

    for (let attempt = 0; attempt < DERIVED_DISPLAY_SET_RETRY_COUNT; attempt += 1) {
      const displaySets = displaySetService.getDisplaySetsForSeries(derivedSeriesInstanceUID) ?? [];
      if (displaySets.length) {
        targetDisplaySet = displaySets[0];
        break;
      }

      await delay(DERIVED_DISPLAY_SET_RETRY_DELAY_MS);
    }

    if (!targetDisplaySet) {
      throw new Error(`Derived series ${derivedSeriesInstanceUID} is not available yet.`);
    }

    const sourceDisplaySet = getPrimaryNonOverlayDisplaySetForViewport(
      viewportGridService,
      displaySetService,
      viewportId,
      {
        excludeDisplaySetInstanceUID: targetDisplaySet.displaySetInstanceUID,
        excludeSeriesInstanceUID: derivedSeriesInstanceUID,
      }
    );

    const referencedSourceSeriesInstanceUID =
      sourceDisplaySet?.SeriesInstanceUID ?? sourceDisplaySet?.instances?.[0]?.SeriesInstanceUID;

    if (sourceDisplaySet?.displaySetInstanceUID) {
      targetDisplaySet.referencedDisplaySetInstanceUID =
        targetDisplaySet.referencedDisplaySetInstanceUID ?? sourceDisplaySet.displaySetInstanceUID;
    }

    if (referencedSourceSeriesInstanceUID) {
      targetDisplaySet.referencedSeriesInstanceUID =
        targetDisplaySet.referencedSeriesInstanceUID ?? referencedSourceSeriesInstanceUID;
    }

    viewportGridService.setActiveViewportId?.(viewportId);
    targetDisplaySet.madeInClient = true;
    displaySetService.addDisplaySets(targetDisplaySet);

    if (targetDisplaySet.Modality === 'SEG' || targetDisplaySet.Modality === 'RTSTRUCT') {
      await activateOverlayDisplaySet(targetDisplaySet, viewportId, {
        viewportGridService,
        displaySetService,
        commandsManager,
      });

      return true;
    }

    try {
      const { isHangingProtocolLayout } = viewportGridService.getState();
      const updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
        viewportId,
        targetDisplaySet.displaySetInstanceUID,
        isHangingProtocolLayout
      );

      commandsManager.run('setDisplaySetsForViewports', {
        viewportsToUpdate: updatedViewports,
      });
    } catch {
      await viewportGridService.setDisplaySetsForViewport({
        viewportId,
        displaySetInstanceUIDs: [targetDisplaySet.displaySetInstanceUID],
      });
    }

    return true;
  };

  const actions = {
    setBackendUrl: ({ value }: { value: string }) => {
      aiWorkflowStore.update(current => ({
        backendUrl: value,
        health: null,
        healthIndicatorState: 'unknown',
        lastHealthCheckedAt: null,
        lastHealthyAt: null,
        modelsLoadedForBackendUrl: null,
        models: current.models,
        lastAction: 'Backend URL updated',
        error: null,
      }));
    },

    setSelectedModel: ({ value }: { value: string }) => {
      const workflow = aiWorkflowStore.getState();
      const model = workflow.models.find(item => item.name === value);

      aiWorkflowStore.update({
        selectedModelName: value,
        selectedTaskType: model?.taskTypes[0] ?? workflow.selectedTaskType,
        lastAction: `Model selected: ${value}`,
        error: null,
      });
    },

    setSelectedTaskType: ({ value }: { value: InferenceTaskType }) => {
      aiWorkflowStore.update({
        selectedTaskType: value,
        lastAction: `Task selected: ${value}`,
        error: null,
      });
    },

    setStudyInstanceUID: ({ value }: { value: string }) => {
      aiWorkflowStore.update({
        studyInstanceUID: value,
        lastAction: 'Study UID updated',
        error: null,
      });
    },

    setSeriesInstanceUID: ({ value }: { value: string }) => {
      aiWorkflowStore.update({
        seriesInstanceUID: value,
        lastAction: 'Series UID updated',
        error: null,
      });
    },

    useActiveViewportReference: () => {
      const reference = getActiveViewportReference();

      if (!reference) {
        aiWorkflowStore.update({
          error: 'Unable to resolve Study/Series UID from the active viewport',
          lastAction: 'Active viewport UID lookup failed',
        });
        return;
      }

      aiWorkflowStore.update({
        studyInstanceUID: reference.studyInstanceUID,
        seriesInstanceUID: reference.seriesInstanceUID,
        lastAction: 'Study/Series UID synced from active viewport',
        error: null,
      });
    },

    setRunAsync: ({ value }: { value: boolean }) => {
      aiWorkflowStore.update({
        runAsync: value,
        lastAction: value ? 'Async mode enabled' : 'Sync mode enabled',
        error: null,
      });
    },

    deleteDisplaySet: async ({ displaySetInstanceUID }: { displaySetInstanceUID?: string }) => {
      if (!displaySetInstanceUID) {
        notify('AI Inference', 'No series was selected for deletion', 'warning');
        return false;
      }

      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID) as
        | {
            StudyInstanceUID?: string;
            SeriesInstanceUID?: string;
            SeriesDescription?: string;
            displaySetLabel?: string;
            label?: string;
            instances?: Array<{
              StudyInstanceUID?: string;
              SeriesInstanceUID?: string;
              SeriesDescription?: string;
            }>;
          }
        | undefined;

      if (!displaySet) {
        notify('AI Inference', 'Series is no longer available in the current session', 'warning');
        return false;
      }

      const seriesInstanceUID = getDisplaySetSeriesInstanceUID(displaySet);
      const studyInstanceUID = getDisplaySetStudyInstanceUID(displaySet);
      const displayLabel = getDisplaySetLabel(displaySet) || seriesInstanceUID || 'Series';

      if (!isAiResultLabel(displayLabel)) {
        const message = 'Only AI result series can be deleted from Orthanc.';
        aiWorkflowStore.update({ error: message, lastAction: 'Series deletion blocked' });
        notify('AI Inference', message, 'warning');
        return false;
      }

      if (!seriesInstanceUID) {
        const message = `${displayLabel} cannot be deleted because it has no SeriesInstanceUID.`;
        aiWorkflowStore.update({ error: message, lastAction: 'Series deletion failed' });
        notify('AI Inference', message, 'error');
        return false;
      }

      try {
        await getApi().deleteSeries(seriesInstanceUID);
        invalidateStudyMetadataCache(studyInstanceUID);
        await removeSeriesFromSession(seriesInstanceUID, { silent: true });
        aiWorkflowStore.update({
          lastAction: `${displayLabel} deleted from Orthanc`,
          error: null,
        });
        notify('AI Inference', `${displayLabel} deleted from Orthanc`, 'success');
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : `${displayLabel} deletion failed`;
        aiWorkflowStore.update({ error: message, lastAction: 'Series deletion failed' });
        notify('AI Inference', message, 'error');
        return false;
      }
    },

    clearSelectedModelResults: async () => {
      const workflow = aiWorkflowStore.getState();
      const modelName = workflow.selectedModelName;
      const currentStudyInstanceUID =
        getActiveViewportReference()?.studyInstanceUID || workflow.studyInstanceUID;

      if (!currentStudyInstanceUID) {
        notify('AI Inference', 'No active study is available to clear results from', 'warning');
        return false;
      }

      const activeDisplaySets = displaySetService.getActiveDisplaySets?.() ?? [];
      const matchingDisplaySets = activeDisplaySets.filter(
        displaySet =>
          isDisplaySetForAiModel(displaySet, modelName) &&
          getDisplaySetStudyInstanceUID(displaySet) === currentStudyInstanceUID
      );
      const uniqueSeries = new Map<
        string,
        {
          studyInstanceUID: string | null;
        }
      >();

      matchingDisplaySets.forEach(displaySet => {
        const seriesInstanceUID = getDisplaySetSeriesInstanceUID(displaySet);

        if (!seriesInstanceUID || uniqueSeries.has(seriesInstanceUID)) {
          return;
        }

        uniqueSeries.set(seriesInstanceUID, {
          studyInstanceUID: getDisplaySetStudyInstanceUID(displaySet),
        });
      });

      let removedCount = 0;

      try {
        for (const [seriesInstanceUID, metadata] of uniqueSeries.entries()) {
          await getApi().deleteSeries(seriesInstanceUID);
          invalidateStudyMetadataCache(metadata.studyInstanceUID);

          const removed = await removeSeriesFromSession(seriesInstanceUID, { silent: true });

          if (removed) {
            removedCount += 1;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Clearing AI results failed';
        aiWorkflowStore.update({
          error: message,
          lastAction: 'Clear results failed',
        });
        notify('AI Inference', message, 'error');
        return false;
      }

      const shouldClearRenderedResult =
        workflow.lastResult?.modelName === modelName &&
        workflow.lastResult?.reference.studyInstanceUID === currentStudyInstanceUID &&
        !!(workflow.renderedAnnotationIds.length || workflow.renderedSegmentationId);

      if (shouldClearRenderedResult) {
        clearRenderedAnnotations(workflow.renderedAnnotationIds);
        clearRenderedSegmentation(workflow.renderedSegmentationId);

        aiWorkflowStore.update(current => ({
          renderedAnnotationIds: [],
          renderedSegmentationId: null,
          lastResult: current.lastResult?.modelName === modelName ? null : current.lastResult,
          recentResults: current.recentResults.filter(
            result =>
              !(
                result.modelName === modelName &&
                result.reference.studyInstanceUID === currentStudyInstanceUID
              )
          ),
          patientReportText: buildPatientReport(
            current.recentResults.filter(
              result =>
                !(
                  result.modelName === modelName &&
                  result.reference.studyInstanceUID === currentStudyInstanceUID
                )
            )
          ),
          focusedFinding: null,
          lastAction: `${modelName} viewport result cleared`,
          error: null,
        }));

        removedCount += 1;
      }

      if (!removedCount) {
        notify(
          'AI Inference',
          `No ${modelName} results are available to clear in the current study`,
          'warning'
        );
        return false;
      }

      aiWorkflowStore.update({
        lastAction: `${modelName} results cleared for the current study`,
        error: null,
      });

      notify(
        'AI Inference',
        `Cleared ${removedCount} ${modelName} result(s) from the current study`,
        'success'
      );
      return true;
    },

    resetWorkflow: () => {
      const workflow = aiWorkflowStore.getState();
      activePollingJobIds.clear();
      clearRenderedAnnotations(workflow.renderedAnnotationIds);
      clearRenderedSegmentation(workflow.renderedSegmentationId);
      aiWorkflowStore.reset();
    },

    applyLastResultToViewport: async ({ result, silent = false }: ResultActionOptions = {}) => {
      const workflow = aiWorkflowStore.getState();
      const targetResult = result ?? workflow.lastResult;

      if (!targetResult) {
        if (!silent) {
          notify('AI Inference', 'No result available to render', 'warning');
        }
        return;
      }

      clearRenderedAnnotations(workflow.renderedAnnotationIds);
      clearRenderedSegmentation(workflow.renderedSegmentationId);

      const rendered = await renderInferenceResultToViewport(
        targetResult,
        servicesManager,
        commandsManager
      );

      aiWorkflowStore.update({
        renderedAnnotationIds: rendered.annotationIds,
        renderedSegmentationId: rendered.segmentationId,
        focusedFinding: null,
        lastAction: 'Rendered AI result into active viewport',
        error: null,
      });

      if (!silent) {
        notify('AI Inference', 'Viewport overlay and annotations refreshed', 'success');
      }
    },

    refreshDerivedSeries: async ({ result, silent = false }: ResultActionOptions = {}) => {
      const workflow = aiWorkflowStore.getState();
      const targetResult = result ?? workflow.lastResult;

      if (!targetResult) {
        if (!silent) {
          notify('AI Inference', 'No result available to refresh', 'warning');
        }
        return false;
      }

      const studyInstanceUID = targetResult.reference.studyInstanceUID;
      const derivedSeriesInstanceUID = targetResult.payload.storage?.derivedSeriesInstanceUID;
      const viewportId = resolveViewportIdForResult(targetResult);

      if (!studyInstanceUID || !derivedSeriesInstanceUID || !viewportId) {
        return false;
      }

      const dataSource = getActiveDataSource();
      const refreshMetadata = dataSource?.retrieve?.series?.metadata;

      if (!refreshMetadata) {
        throw new Error('Active data source does not expose series metadata refresh.');
      }

      await waitForDerivedDisplaySet(
        studyInstanceUID,
        derivedSeriesInstanceUID,
        dataSource,
        refreshMetadata
      );

      await activateDerivedDisplaySet(derivedSeriesInstanceUID, viewportId);

      aiWorkflowStore.update({
        lastAction: `Derived series ${derivedSeriesInstanceUID} refreshed and displayed`,
        error: null,
      });

      if (!silent) {
        notify('AI Inference', 'Derived series refreshed and displayed', 'success');
      }

      return true;
    },

    renderFindingFromSr: async ({
      findingText,
      referencedSOPInstanceUID,
    }: {
      findingText: string;
      referencedSOPInstanceUID?: string | null;
    }) => {
      const parsedFinding = parseFindingText(findingText, referencedSOPInstanceUID);

      if (!parsedFinding) {
        return false;
      }

      const activeViewportReference = getActiveViewportReference();
      if (!activeViewportReference) {
        return false;
      }

      const syntheticResult: InferenceResult = {
        jobId: `sr-finding-${Date.now()}`,
        inferenceId: `sr-finding-${Date.now()}`,
        status: 'completed',
        modelName: 'yolo',
        taskType: 'detection',
        resultFormat: 'dicom-sr',
        reference: {
          studyInstanceUID: activeViewportReference.studyInstanceUID,
          seriesInstanceUID: activeViewportReference.seriesInstanceUID,
        },
        payload: {
          summary: findingText,
          visualizations: {
            detections: [parsedFinding.detection],
          },
          storage: {
            mode: 'overlay-only',
          },
        },
        createdAt: getIsoNow(),
        completedAt: getIsoNow(),
        error: null,
      };

      clearRenderedAnnotations(aiWorkflowStore.getState().renderedAnnotationIds);
      const rendered = await renderInferenceResultToViewport(
        syntheticResult,
        servicesManager,
        commandsManager
      );

      aiWorkflowStore.update({
        renderedAnnotationIds: rendered.annotationIds,
        renderedSegmentationId: null,
        focusedFinding: parsedFinding.focusedFinding,
        lastAction: 'SR finding restored on source image',
        error: null,
      });

      return true;
    },

    generatePatientReport: () => {
      const workflow = aiWorkflowStore.getState();
      const activeStudyInstanceUID =
        getActiveViewportReference()?.studyInstanceUID || workflow.studyInstanceUID || null;
      const reportResults = activeStudyInstanceUID
        ? workflow.recentResults.filter(
            result => result.reference.studyInstanceUID === activeStudyInstanceUID
          )
        : workflow.recentResults;
      const patientReportText = buildPatientReport(reportResults);

      if (!patientReportText) {
        notify(
          'AI Inference',
          'No AI result is available for patient report generation',
          'warning'
        );
        return null;
      }

      aiWorkflowStore.update({
        patientReportText,
        lastAction: 'Patient AI report generated',
        error: null,
      });

      notify('AI Inference', 'Patient AI report generated', 'success');
      return patientReportText;
    },

    checkBackendHealth: async () => {
      if (healthCheckInFlight) {
        return;
      }

      healthCheckInFlight = true;

      try {
        const health = await getApi().getHealth();
        const checkedAt = health.checkedAt ?? getIsoNow();
        const indicator = getIndicatorStateFromHealth(health);

        aiWorkflowStore.update(current => ({
          health,
          healthIndicatorState: indicator,
          lastHealthCheckedAt: checkedAt,
          lastHealthyAt: checkedAt,
          lastAction:
            indicator === 'online'
              ? 'Backend and AI services online'
              : 'Backend online, some AI services unavailable',
          error: current.healthIndicatorState === 'offline' ? null : current.error,
        }));

        const workflow = aiWorkflowStore.getState();
        const shouldRefreshModelsForRecoveredRuntime =
          workflow.modelsLoadedForBackendUrl === workflow.backendUrl &&
          workflow.models.length > 0 &&
          workflow.models.every(model => !model.configured) &&
          health.runtimeServices.some(runtime => runtime.enabled || runtime.configured);

        if (
          workflow.modelsLoadedForBackendUrl !== workflow.backendUrl ||
          shouldRefreshModelsForRecoveredRuntime
        ) {
          void actions.loadModels({
            silent: true,
            force: shouldRefreshModelsForRecoveredRuntime,
          });
        }
      } catch {
        aiWorkflowStore.update(current => ({
          health: null,
          healthIndicatorState: getOfflineIndicatorState(current.lastHealthyAt),
          lastHealthCheckedAt: getIsoNow(),
          lastAction: 'Backend offline',
        }));
      } finally {
        healthCheckInFlight = false;
      }
    },

    loadModels: async ({
      silent = false,
      force = false,
    }: { silent?: boolean; force?: boolean } = {}) => {
      const workflow = aiWorkflowStore.getState();
      if (
        modelsLoadInFlight ||
        (!force && workflow.modelsLoadedForBackendUrl === workflow.backendUrl)
      ) {
        return;
      }

      modelsLoadInFlight = true;

      try {
        const models = await getApi().getModels();
        const fallbackModel = models[0];

        aiWorkflowStore.update(current => {
          const selectedModel = models.find(item => item.name === current.selectedModelName);
          const nextSelectedModel = selectedModel ?? fallbackModel;

          return {
            models,
            selectedModelName: nextSelectedModel?.name ?? '',
            selectedTaskType: nextSelectedModel?.taskTypes[0] ?? current.selectedTaskType,
            modelsLoadedForBackendUrl: current.backendUrl,
            lastAction: 'Models loaded',
            error: null,
          };
        });

        if (!silent) {
          notify('AI Models', `Loaded ${models.length} model definitions`, 'success');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load model definitions';
        aiWorkflowStore.update({
          error: message,
          lastAction: 'Model loading failed',
        });
      } finally {
        modelsLoadInFlight = false;
      }
    },

    pollJobUntilFinished: async ({
      jobId,
      inferenceId,
      seriesLabel,
    }: {
      jobId: string;
      inferenceId: string;
      seriesLabel: string;
    }) => {
      if (activePollingJobIds.has(jobId)) {
        return;
      }

      activePollingJobIds.add(jobId);

      while (activePollingJobIds.has(jobId)) {
        try {
          const job = await getApi().getJob(jobId);
          upsertTask({
            jobId: job.jobId,
            inferenceId,
            modelName: job.modelName,
            taskType: job.taskType,
            seriesLabel,
            status: job.status,
            startedAt:
              job.status === 'running'
                ? (getTaskByInferenceId(inferenceId)?.startedAt ?? job.updatedAt ?? getIsoNow())
                : undefined,
            completedAt:
              job.status === 'completed' || job.status === 'failed' ? job.updatedAt : null,
            error: job.error ?? null,
          });

          aiWorkflowStore.update({
            lastJob: job,
            lastAction: `Job ${getTaskStatusLabel(job.status)}`,
            error: job.status === 'failed' ? (job.error ?? 'Inference job failed') : null,
          });

          if (job.status === 'completed') {
            const result = await getApi().getResult(job.inferenceId);
            activePollingJobIds.delete(jobId);

            upsertTask({
              jobId: result.jobId,
              inferenceId: result.inferenceId,
              modelName: result.modelName,
              taskType: result.taskType,
              seriesLabel,
              status: result.status,
              submittedAt: result.createdAt ?? getIsoNow(),
              startedAt: result.createdAt ?? getIsoNow(),
              completedAt: result.completedAt ?? getIsoNow(),
              error: result.error ?? null,
            });

            aiWorkflowStore.update({
              lastAction: 'Inference completed',
              error: null,
            });
            upsertRecentResult(result);

            const task = getTaskByInferenceId(result.inferenceId);
            let message = buildCompletionMessage(
              task ?? {
                jobId: result.jobId,
                inferenceId: result.inferenceId,
                modelName: result.modelName,
                taskType: result.taskType,
                seriesLabel,
                status: result.status,
                submittedAt: result.createdAt ?? getIsoNow(),
                startedAt: result.createdAt ?? getIsoNow(),
                completedAt: result.completedAt ?? getIsoNow(),
                error: null,
              },
              result,
              result.payload.storage?.derivedSeriesInstanceUID
                ? 'Derived result displayed.'
                : 'Result rendered.'
            );
            let messageType: 'success' | 'warning' = 'success';

            try {
              if (result.payload.storage?.derivedSeriesInstanceUID) {
                await actions.refreshDerivedSeries({ result, silent: true });
              } else {
                await actions.applyLastResultToViewport({ result, silent: true });
              }
            } catch (error) {
              const displayMessage =
                error instanceof Error
                  ? error.message
                  : 'Completed, but displaying the result failed';
              aiWorkflowStore.update({
                error: displayMessage,
                lastAction: 'Result display failed',
              });
              message = `${seriesLabel} · ${result.modelName} done. ${displayMessage}`;
              messageType = 'warning';
            }

            notify('AI Inference', message, messageType);
            return;
          }

          if (job.status === 'failed') {
            activePollingJobIds.delete(jobId);
            notify('AI Inference', job.error ?? `${seriesLabel} inference failed`, 'error');
            return;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to refresh job';
          activePollingJobIds.delete(jobId);
          upsertTask({
            jobId,
            inferenceId,
            seriesLabel,
            status: 'failed',
            completedAt: getIsoNow(),
            error: message,
          });
          aiWorkflowStore.update({
            error: message,
            lastAction: 'Job refresh failed',
          });
          notify('AI Inference', message, 'error');
          return;
        }

        await delay(ASYNC_JOB_POLL_INTERVAL_MS);
      }
    },

    runInference: async () => {
      const workflow = aiWorkflowStore.getState();
      const activeViewportReference = getActiveViewportReference();
      const studyInstanceUID =
        activeViewportReference?.studyInstanceUID || workflow.studyInstanceUID;
      const seriesInstanceUID =
        activeViewportReference?.seriesInstanceUID || workflow.seriesInstanceUID;
      const viewportId = activeViewportReference?.viewportId ?? null;
      const seriesNumber = activeViewportReference?.seriesNumber ?? null;
      const seriesLabel = activeViewportReference?.seriesLabel ?? 'Current Series';
      const inferenceId = globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}`;
      const submittedAt = getIsoNow();

      const selectedRuntime = workflow.health?.runtimeServices.find(
        runtime => runtime.family === workflow.selectedModelName
      );

      if (selectedRuntime?.enabled && selectedRuntime.status !== 'online') {
        const message = `${workflow.selectedModelName} runtime is offline`;
        aiWorkflowStore.update({ error: message, lastAction: 'Inference blocked' });
        notify('AI Inference', message, 'warning');
        return;
      }

      if (isActiveViewportAiResult()) {
        const message =
          'Current active series is already an AI result. Select an original source series before running inference.';
        aiWorkflowStore.update({ isBusy: false, error: message, lastAction: 'Inference blocked' });
        notify('AI Inference', message, 'warning');
        return;
      }

      if (!studyInstanceUID || !seriesInstanceUID) {
        const message = 'No active image series found to infer against';
        aiWorkflowStore.update({
          isBusy: false,
          error: message,
          lastAction: 'Inference failed',
        });
        notify('AI Inference', message, 'error');
        return;
      }

      upsertTask({
        jobId: `pending-${inferenceId}`,
        inferenceId,
        modelName: workflow.selectedModelName,
        taskType: workflow.selectedTaskType,
        viewportId,
        seriesNumber,
        seriesLabel,
        status: workflow.runAsync ? 'queued' : 'running',
        submittedAt,
        startedAt: workflow.runAsync ? null : submittedAt,
        completedAt: null,
        error: null,
      });

      aiWorkflowStore.update({
        studyInstanceUID,
        seriesInstanceUID,
        isBusy: true,
        lastAction: 'Submitting inference request...',
        error: null,
      });

      try {
        const result = await getApi().infer({
          inferenceId,
          modelName: workflow.selectedModelName,
          taskType: workflow.selectedTaskType,
          submittedAt,
          studyInstanceUID,
          seriesInstanceUID,
          options: {
            async: workflow.runAsync,
          },
        });

        upsertTask({
          jobId: result.jobId,
          inferenceId: result.inferenceId,
          modelName: result.modelName,
          taskType: result.taskType,
          viewportId,
          seriesNumber,
          seriesLabel,
          status: result.status,
          submittedAt: result.createdAt ?? submittedAt,
          startedAt: result.status === 'queued' ? null : (result.createdAt ?? submittedAt),
          completedAt: result.status === 'completed' ? (result.completedAt ?? getIsoNow()) : null,
          error: result.error ?? null,
        });

        aiWorkflowStore.update({
          isBusy: false,
          lastAction: `Inference ${getTaskStatusLabel(result.status)}`,
          lastJob: {
            jobId: result.jobId,
            inferenceId: result.inferenceId,
            status: result.status,
            modelName: result.modelName,
            taskType: result.taskType,
            updatedAt: result.completedAt ?? result.createdAt,
            resultReady: result.status === 'completed',
            error: result.error ?? null,
          },
          error: null,
        });

        if (result.status === 'completed') {
          upsertRecentResult(result);
        }

        if (result.status === 'completed') {
          const task = getTaskByInferenceId(result.inferenceId);
          let message = buildCompletionMessage(
            task ?? {
              jobId: result.jobId,
              inferenceId: result.inferenceId,
              modelName: result.modelName,
              taskType: result.taskType,
              viewportId,
              seriesLabel,
              status: result.status,
              submittedAt: result.createdAt ?? submittedAt,
              startedAt: result.createdAt ?? submittedAt,
              completedAt: result.completedAt ?? getIsoNow(),
              error: null,
            },
            result,
            result.payload.storage?.derivedSeriesInstanceUID
              ? 'Derived result displayed.'
              : 'Result rendered.'
          );
          let messageType: 'success' | 'warning' = 'success';

          try {
            if (result.payload.storage?.derivedSeriesInstanceUID) {
              await actions.refreshDerivedSeries({ result, silent: true });
            } else {
              await actions.applyLastResultToViewport({ result, silent: true });
            }
          } catch (error) {
            const displayMessage =
              error instanceof Error
                ? error.message
                : 'Completed, but displaying the result failed';
            aiWorkflowStore.update({ error: displayMessage, lastAction: 'Result display failed' });
            message = `${seriesLabel} · ${result.modelName} done. ${displayMessage}`;
            messageType = 'warning';
          }

          notify('AI Inference', message, messageType);
        } else {
          void actions.pollJobUntilFinished({
            jobId: result.jobId,
            inferenceId: result.inferenceId,
            seriesLabel,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Inference request failed';
        upsertTask({
          jobId: `pending-${inferenceId}`,
          inferenceId,
          modelName: workflow.selectedModelName,
          taskType: workflow.selectedTaskType,
          viewportId,
          seriesLabel,
          status: 'failed',
          submittedAt,
          startedAt: submittedAt,
          completedAt: getIsoNow(),
          error: message,
        });
        aiWorkflowStore.update({ isBusy: false, error: message, lastAction: 'Inference failed' });
        notify('AI Inference', message, 'error');
      }
    },

    refreshJob: async () => {
      const workflow = aiWorkflowStore.getState();
      if (!workflow.lastJob) {
        return;
      }

      const task = getTaskByInferenceId(workflow.lastJob.inferenceId);
      await actions.pollJobUntilFinished({
        jobId: workflow.lastJob.jobId,
        inferenceId: workflow.lastJob.inferenceId,
        seriesLabel: task?.seriesLabel ?? 'Current Series',
      });
    },
  };

  const definitions = {
    aiInferenceSetBackendUrl: {
      commandFn: actions.setBackendUrl,
    },
    aiInferenceSetSelectedModel: {
      commandFn: actions.setSelectedModel,
    },
    aiInferenceSetSelectedTaskType: {
      commandFn: actions.setSelectedTaskType,
    },
    aiInferenceSetStudyInstanceUID: {
      commandFn: actions.setStudyInstanceUID,
    },
    aiInferenceSetSeriesInstanceUID: {
      commandFn: actions.setSeriesInstanceUID,
    },
    aiInferenceUseActiveViewportReference: {
      commandFn: actions.useActiveViewportReference,
    },
    aiInferenceSetRunAsync: {
      commandFn: actions.setRunAsync,
    },
    aiInferenceDeleteDisplaySet: {
      commandFn: actions.deleteDisplaySet,
    },
    aiInferenceClearSelectedModelResults: {
      commandFn: actions.clearSelectedModelResults,
    },
    aiInferenceResetWorkflow: {
      commandFn: actions.resetWorkflow,
    },
    aiInferenceApplyLastResultToViewport: {
      commandFn: actions.applyLastResultToViewport,
    },
    aiInferenceRefreshDerivedSeries: {
      commandFn: actions.refreshDerivedSeries,
    },
    aiInferenceRenderFindingFromSr: {
      commandFn: actions.renderFindingFromSr,
    },
    aiInferenceCheckBackendHealth: {
      commandFn: actions.checkBackendHealth,
    },
    aiInferenceLoadModels: {
      commandFn: actions.loadModels,
    },
    aiInferenceRunInference: {
      commandFn: actions.runInference,
    },
    aiInferenceGeneratePatientReport: {
      commandFn: actions.generatePatientReport,
    },
    aiInferenceRefreshJob: {
      commandFn: actions.refreshJob,
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'AI_INFERENCE',
  };
};

export default getCommandsModule;
