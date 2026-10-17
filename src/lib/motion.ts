import { addTransitionType, startTransition, type ViewTransitionClassPerType } from 'react';

/**
 * Motion vocabulary shared by components and globals.css (spec:
 * docs/superpowers/specs/2026-10-08-motion-design.md). Every named
 * <ViewTransition> animates only for the transition types below, so a
 * component never animates for someone else's transition: a local drag drop,
 * a filter change or a page navigation all run with no type, or another type.
 */

/** A live refresh: something a teammate did. */
export const REMOTE_REFRESH = 'remote-refresh';
/** ?task= added / removed by opening or closing the task modal. */
export const TASK_OPEN = 'task-open';
export const TASK_CLOSE = 'task-close';
/** Summary / Board / List / Calendar and saved-view tabs: to a tab right / left of the open one. */
export const VIEW_FORWARD = 'view-forward';
export const VIEW_BACK = 'view-back';
/** A to-do added, edited, moved, checked or deleted. */
export const TODO_CHANGE = 'todo-change';
/** A subtask deleted or moved in the task modal. */
export const SUBTASK_CHANGE = 'subtask-change';
/** A notification cleared from the bell. */
export const BELL_CHANGE = 'bell-change';

/** The CSS tokens in globals.css, for JS-driven animation (dnd-kit's drop). */
export const EASE_OUT_SOFT = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const EASE_SPRING =
  'linear(0, 0.06 3%, 0.22 7%, 0.46 12%, 0.7 18%, 0.87 24%, 0.97 31%, 1.03 39%, 1.045 46%, 1.04 53%, 1.02 62%, 1.005 74%, 0.998 86%, 1)';
export const DURATION = { fast: 120, base: 180, slow: 280 } as const;

/** A view-transition class for one transition type, `none` for every other. */
export function onlyOn(type: string, className: string): ViewTransitionClassPerType {
  return { [type]: className, default: 'none' };
}

export const taskTransitionName = (taskId: string) => `task-${taskId}`;
export const cardTransitionName = (id: string) => `card-${id}`;
export const rowTransitionName = (id: string) => `row-${id}`;
export const todoTransitionName = (id: string) => `todo-${id}`;
export const subtaskTransitionName = (id: string) => `subtask-${id}`;
export const bellTransitionName = (id: string) => `bell-${id}`;

/**
 * The name a card or row shares with the task modal. A view-transition name
 * must be unique on the page, and the card stays mounted while its task is
 * open, so the card gives the name up (undefined) for as long as the modal has it.
 */
export function taskMorphName(taskId: string, openTaskId: string | null | undefined): string | undefined {
  return taskId === openTaskId ? undefined : taskTransitionName(taskId);
}

/** Card/row side of the modal morph. The modal side is TASK_MODAL_CLASSES. */
export const TASK_MORPH_SHARE: ViewTransitionClassPerType = {
  [TASK_OPEN]: 'task-morph', [TASK_CLOSE]: 'task-morph', default: 'none',
};

/** The task modal: morphs with its card, pops in and out when there is none. */
export const TASK_MODAL_CLASSES = { share: 'task-morph', enter: 'task-pop', exit: 'task-pop', default: 'none' } as const;

/** Board cards and list rows: a teammate's move, add or delete. */
export const REMOTE_CHANGE = {
  share: onlyOn(REMOTE_REFRESH, 'card-move'),
  update: onlyOn(REMOTE_REFRESH, 'card-move'),
  enter: onlyOn(REMOTE_REFRESH, 'card-enter'),
  exit: onlyOn(REMOTE_REFRESH, 'card-exit'),
  default: 'none',
} as const;

export const TODO_CHANGE_CLASSES = {
  enter: onlyOn(TODO_CHANGE, 'todo-enter'),
  exit: onlyOn(TODO_CHANGE, 'todo-exit'),
  share: onlyOn(TODO_CHANGE, 'todo-move'),
  update: onlyOn(TODO_CHANGE, 'todo-shift'),
  default: 'none',
} as const;

/**
 * Subtask rows in the task modal: my own deletes and moves, and a teammate's. No
 * enter: an added row grows in by a keyframe (SubtaskSection says why).
 */
export const SUBTASK_CHANGE_CLASSES = {
  exit: { [SUBTASK_CHANGE]: 'subtask-exit', [REMOTE_REFRESH]: 'subtask-exit', default: 'none' },
  update: { [SUBTASK_CHANGE]: 'subtask-shift', [REMOTE_REFRESH]: 'subtask-shift', default: 'none' },
  default: 'none',
} as const;

export const BELL_CHANGE_CLASSES = {
  exit: onlyOn(BELL_CHANGE, 'bell-exit'),
  update: onlyOn(BELL_CHANGE, 'bell-shift'),
  default: 'none',
} as const;

/** The bell's empty state fading in after a clear. */
export const BELL_EMPTY_CLASSES = { enter: onlyOn(BELL_CHANGE, 'vt-fade-in'), default: 'none' } as const;

const VIEW_SLIDE: ViewTransitionClassPerType = {
  [VIEW_FORWARD]: 'view-slide-forward', [VIEW_BACK]: 'view-slide-back', default: 'none',
};

/** The old view slides out and the new one in, toward the picked tab's side. */
export const VIEW_SWITCH_CLASSES = { enter: VIEW_SLIDE, exit: VIEW_SLIDE, default: 'none' } as const;

/** The project header: held still above the sliding view, the new one shown at once. */
export const PROJECT_HEADER_NAME = 'project-header';
export const PROJECT_HEADER_CLASSES = {
  share: { [VIEW_FORWARD]: 'view-anchor', [VIEW_BACK]: 'view-anchor', default: 'none' },
  default: 'none',
} as const;

/** The transition type for going from tab `from` to tab `to` (indexes in tab order). */
export function viewSwitchType(from: number, to: number): string {
  return to < from ? VIEW_BACK : VIEW_FORWARD;
}

/** Every class above: globals.css must style each (tests/unit/motion-css.test.ts). */
export const MOTION_CLASSES: readonly string[] = [
  'task-morph', 'task-pop', 'card-move', 'card-enter', 'card-exit',
  'todo-enter', 'todo-exit', 'todo-move', 'todo-shift', 'subtask-exit', 'subtask-shift', 'bell-exit', 'bell-shift', 'vt-fade-in', 'view-slide-forward', 'view-slide-back', 'view-anchor',
];

/** The view-switch key: a new route or saved view, never a filter or ?task change. */
export function viewSwitchKey(pathname: string, view: string | null): string {
  return view ? `${pathname}?view=${view}` : pathname;
}

/**
 * Runs `scope` in a transition tagged `type`. For callers that do not own a
 * transition (router.refresh() has no transitionTypes option).
 */
export function startTypedTransition(
  type: string,
  scope: () => void,
  deps: { startTransition: (scope: () => void) => void; addTransitionType: (type: string) => void } =
    { startTransition, addTransitionType },
): void {
  deps.startTransition(() => {
    deps.addTransitionType(type);
    scope();
  });
}
