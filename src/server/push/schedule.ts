import { after } from 'next/server';
import { vapidConfig } from './config';
import { deliverPush, type PushRef } from './deliver';

/**
 * Pushes these rows after this request's response, once the caller's transaction
 * has committed. after() runs even on rollback; deliverPush re-reads by stamp, so a
 * rolled-back write sends nothing. Outside a request (seed, scripts) nothing pushes.
 */
export function schedulePush(refs: PushRef[]): void {
  if (refs.length === 0 || !vapidConfig()) return;
  try {
    after(() => deliverPush(refs));
  } catch {
    // No request scope.
  }
}
