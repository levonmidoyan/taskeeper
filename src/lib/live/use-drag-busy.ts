import { useEffect, useMemo } from 'react';
import { markBusy, releaseBusy } from './busy';

/**
 * Handlers for a DndContext: live refreshes wait while a drag is in progress.
 * Released on unmount too, so navigating away mid-drag cannot leave refreshes
 * blocked.
 */
export function useDragBusy(key: string): { start: () => void; end: () => void } {
  useEffect(() => () => releaseBusy(key), [key]);
  return useMemo(() => ({ start: () => markBusy(key), end: () => releaseBusy(key) }), [key]);
}
