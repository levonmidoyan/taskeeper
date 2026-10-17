import { describe, expect, it, vi } from 'vitest';
import {
  BELL_CHANGE_CLASSES, MOTION_CLASSES, onlyOn, REMOTE_CHANGE, REMOTE_REFRESH, startTypedTransition, SUBTASK_CHANGE,
  SUBTASK_CHANGE_CLASSES,
  TASK_CLOSE, TASK_MODAL_CLASSES, TASK_MORPH_SHARE, TASK_OPEN, taskMorphName, taskTransitionName,
  TODO_CHANGE_CLASSES, VIEW_BACK, VIEW_FORWARD, VIEW_SWITCH_CLASSES, viewSwitchKey, viewSwitchType,
} from '@/lib/motion';

describe('onlyOn', () => {
  it('animates for one type and nothing else', () => {
    expect(onlyOn('remote-refresh', 'card-move')).toEqual({ 'remote-refresh': 'card-move', default: 'none' });
  });
});

describe('taskMorphName', () => {
  it('names a card after its task', () => {
    expect(taskMorphName('abc', null)).toBe('task-abc');
    expect(taskMorphName('abc', 'other')).toBe('task-abc');
    expect(taskTransitionName('abc')).toBe('task-abc');
  });

  it('drops the name while that task is open, so the modal holds it alone', () => {
    expect(taskMorphName('abc', 'abc')).toBeUndefined();
  });
});

describe('class maps', () => {
  it('morph only on task open and close', () => {
    expect(TASK_MORPH_SHARE).toEqual({ [TASK_OPEN]: 'task-morph', [TASK_CLOSE]: 'task-morph', default: 'none' });
  });

  it('remote changes animate only on live refresh', () => {
    for (const key of ['share', 'update', 'enter', 'exit'] as const) {
      expect(REMOTE_CHANGE[key]).toMatchObject({ default: 'none' });
      expect(Object.keys(REMOTE_CHANGE[key])).toEqual([REMOTE_REFRESH, 'default']);
    }
    expect(REMOTE_CHANGE.default).toBe('none');
  });

  it('subtask rows animate on my own changes and live refreshes only, never entering', () => {
    for (const key of ['update', 'exit'] as const) {
      expect(Object.keys(SUBTASK_CHANGE_CLASSES[key]).sort()).toEqual([REMOTE_REFRESH, SUBTASK_CHANGE, 'default'].sort());
      expect(SUBTASK_CHANGE_CLASSES[key].default).toBe('none');
    }
    expect(SUBTASK_CHANGE_CLASSES).not.toHaveProperty('enter');
  });

  it('every per-item map is off by default', () => {
    for (const map of [REMOTE_CHANGE, TODO_CHANGE_CLASSES, SUBTASK_CHANGE_CLASSES, BELL_CHANGE_CLASSES, VIEW_SWITCH_CLASSES]) {
      expect(map.default).toBe('none');
    }
    expect(TASK_MODAL_CLASSES.default).toBe('none');
  });

  it('lists every class the maps use', () => {
    expect([...MOTION_CLASSES].sort()).toEqual([
      'bell-exit', 'bell-shift', 'card-enter', 'card-exit', 'card-move', 'subtask-exit', 'subtask-shift', 'task-morph', 'task-pop',
      'todo-enter', 'todo-exit', 'todo-move', 'todo-shift', 'view-anchor', 'view-slide-back', 'view-slide-forward',
      'vt-fade-in',
    ]);
  });
});

describe('viewSwitchKey', () => {
  it('changes with the route or the saved view, not with other params', () => {
    expect(viewSwitchKey('/w/projects/p', null)).toBe('/w/projects/p');
    expect(viewSwitchKey('/w/projects/p', 'v1')).toBe('/w/projects/p?view=v1');
  });
});

describe('startTypedTransition', () => {
  it('tags the transition before running the scope inside it', () => {
    const calls: string[] = [];
    const startTransition = vi.fn((scope: () => void) => { calls.push('start'); scope(); calls.push('end'); });
    const addTransitionType = vi.fn((type: string) => { calls.push(`tag:${type}`); });
    startTypedTransition('remote-refresh', () => calls.push('scope'), { startTransition, addTransitionType });
    expect(calls).toEqual(['start', 'tag:remote-refresh', 'scope', 'end']);
  });
});

describe('viewSwitchType', () => {
  it('slides toward the side of the picked tab', () => {
    expect(viewSwitchType(1, 2)).toBe(VIEW_FORWARD);
    expect(viewSwitchType(2, 0)).toBe(VIEW_BACK);
  });

  it('slides forward from an unknown tab', () => {
    expect(viewSwitchType(-1, 0)).toBe(VIEW_FORWARD);
  });
});
