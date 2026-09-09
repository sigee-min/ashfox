import type { ProjectAssets } from '@ashfox/render-core/assets';
import type { ProjectSnapshot } from '../../../application/snapshot';
import {
  areVisualReviewLedgersEqual,
  isValidVisualReviewReceipt,
  recordVisualReview,
  type VisualReviewReceipt
} from '../../../application/review';
import {
  historyReducer,
  type HistoryAction,
  type HistoryState
} from '../../../application/historyReducer';

/** Canonical project, assets, reviews, and local-storage generation state. */
export interface ProjectStorageSession {
  generation: number;
  restoreFromStorage: boolean;
}

export interface ProjectSessionState {
  history: HistoryState;
  assets: ProjectAssets;
  visualReviews: readonly VisualReviewReceipt[];
  storage: ProjectStorageSession;
}

export type ProjectSessionAction =
  | HistoryAction
  | { type: 'replace'; record: ProjectSnapshot }
  | { type: 'visualReview.record'; receipt: VisualReviewReceipt };

const validVisualReviewsFor = (
  project: ProjectSessionState['history']['present'],
  visualReviews: readonly VisualReviewReceipt[]
): readonly VisualReviewReceipt[] => visualReviews
  .filter((receipt) => receipt.projectId === project.id &&
    receipt.revision === project.revision &&
    isValidVisualReviewReceipt(receipt, project))
  .map((receipt) => structuredClone(receipt));

export const createProjectSessionState = (
  history: HistoryState,
  assets: ProjectAssets = {},
  restoreFromStorage = true,
  visualReviews: readonly VisualReviewReceipt[] = []
): ProjectSessionState => ({
  history,
  assets,
  visualReviews: validVisualReviewsFor(history.present, visualReviews),
  storage: { generation: 0, restoreFromStorage }
});

const applyProjectRecord = (
  state: ProjectSessionState,
  action: Extract<HistoryAction, { type: 'hydrate' | 'external' }>
): ProjectSessionState => {
  const history = historyReducer(state.history, action);
  if (action.type === 'external' && history === state.history) return state;
  const recordMatchesHistory = action.record.project.id === history.present.id &&
    action.record.project.revision === history.present.revision;
  const visualReviews = recordMatchesHistory
    ? validVisualReviewsFor(history.present, action.record.visualReviews) : [];
  if (history === state.history &&
    areVisualReviewLedgersEqual(state.visualReviews, visualReviews)) return state;
  return { ...state, history, assets: {}, visualReviews };
};

export const projectSessionReducer = (
  state: ProjectSessionState,
  action: ProjectSessionAction
): ProjectSessionState => {
  if (action.type === 'visualReview.record') {
    const project = state.history.present;
    if (action.receipt.projectId !== project.id ||
      action.receipt.revision !== project.revision ||
      !isValidVisualReviewReceipt(action.receipt, project)) return state;
    const visualReviews = recordVisualReview(state.visualReviews, action.receipt);
    return areVisualReviewLedgersEqual(state.visualReviews, visualReviews)
      ? state : { ...state, visualReviews };
  }
  if (action.type === 'replace') {
    const history = historyReducer(state.history, {
      type: 'hydrate', record: action.record
    });
    return {
      history,
      assets: {},
      visualReviews: history.present.id === action.record.project.id &&
        history.present.revision === action.record.project.revision
        ? validVisualReviewsFor(history.present, action.record.visualReviews) : [],
      storage: { generation: state.storage.generation + 1, restoreFromStorage: false }
    };
  }
  if (action.type === 'hydrate' || action.type === 'external') {
    return applyProjectRecord(state, action);
  }
  const history = historyReducer(state.history, action);
  if (history === state.history) return state;
  if (history.present.id !== state.history.present.id) {
    return {
      history, assets: {}, visualReviews: [],
      storage: { generation: state.storage.generation + 1, restoreFromStorage: false }
    };
  }
  return {
    ...state,
    history,
    visualReviews: history.present.revision === state.history.present.revision
      ? state.visualReviews : []
  };
};
