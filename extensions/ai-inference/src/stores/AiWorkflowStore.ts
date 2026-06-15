import { useSyncExternalStore } from 'react';
import { DEFAULT_BACKEND_URL, SUPPORTED_MODELS } from '../constants';
import { WorkflowState } from '../types';

const initialState: WorkflowState = {
  backendUrl: DEFAULT_BACKEND_URL,
  selectedModelName: SUPPORTED_MODELS[0].name,
  selectedTaskType: SUPPORTED_MODELS[0].taskTypes[0],
  studyInstanceUID: '',
  seriesInstanceUID: '',
  runAsync: true,
  isBusy: false,
  lastAction: 'Idle',
  error: null,
  health: null,
  healthIndicatorState: 'unknown',
  lastHealthCheckedAt: null,
  lastHealthyAt: null,
  modelsLoadedForBackendUrl: null,
  models: SUPPORTED_MODELS,
  lastJob: null,
  lastResult: null,
  tasks: [],
  renderedAnnotationIds: [],
  renderedSegmentationId: null,
};

let state: WorkflowState = initialState;

const listeners = new Set<() => void>();

const emitChange = () => {
  listeners.forEach(listener => listener());
};

export const aiWorkflowStore = {
  getState(): WorkflowState {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },

  update(patch: Partial<WorkflowState> | ((current: WorkflowState) => Partial<WorkflowState>)) {
    const nextPatch = typeof patch === 'function' ? patch(state) : patch;
    state = {
      ...state,
      ...nextPatch,
    };
    emitChange();
  },

  reset() {
    state = initialState;
    emitChange();
  },
};

export function useAiWorkflowStore(): WorkflowState {
  return useSyncExternalStore(
    aiWorkflowStore.subscribe,
    aiWorkflowStore.getState,
    aiWorkflowStore.getState
  );
}
