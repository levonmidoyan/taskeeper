/**
 * Web push: which notification kinds push, per the user's toggles. Pure, so the
 * sender, the settings form and tests share it.
 */
import type { BellKind } from './notifications';

export type PushPrefs = { reminders: boolean; mentions: boolean; taskChanges: boolean; projectChanges: boolean };

export const PUSH_DEFAULTS: PushPrefs = { reminders: true, mentions: true, taskChanges: true, projectChanges: false };

const TOGGLE: Record<BellKind, keyof PushPrefs | null> = {
  reminder: 'reminders',
  mention: 'mentions',
  task_change: 'taskChanges',
  project_change: 'projectChanges',
  // Daily email content; a phone buzz each morning would be noise.
  digest: null,
};

export function pushAllowed(kind: BellKind, prefs: PushPrefs): boolean {
  const key = TOGGLE[kind];
  return key !== null && prefs[key];
}
