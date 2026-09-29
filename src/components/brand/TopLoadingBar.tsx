'use client';

import { useEffect, useState } from 'react';
import { getPendingRequests, installRequestTracking, subscribeToRequests } from '@/lib/request-tracker';

// Requests faster than this finish before the bar appears, so quick saves never flicker.
const SHOW_DELAY_MS = 150;
const TRICKLE_MS = 250;
const FINISH_MS = 200;
const FADE_MS = 300;

type Phase = 'idle' | 'loading' | 'finishing';

/**
 * Indigo progress bar pinned to the top of the viewport while any request is in
 * flight. Progress is not real (fetch reports no upload/download size for RSC or
 * server actions): it trickles towards 90% and snaps to 100% when the last
 * request settles.
 */
export function TopLoadingBar() {
  const [{ phase, progress }, setBar] = useState<{ phase: Phase; progress: number }>({
    phase: 'idle',
    progress: 0,
  });

  useEffect(() => {
    const uninstall = installRequestTracking();
    let current: Phase = 'idle';
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    let trickle: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      showTimer = undefined;
      current = 'loading';
      setBar({ phase: 'loading', progress: 0.08 });
      // Ease towards 90%: big steps early, slower as it closes in, never stalls fully.
      trickle = setInterval(() => {
        setBar((bar) => ({
          ...bar,
          progress: Math.min(0.9, bar.progress + (0.9 - bar.progress) * (0.08 + Math.random() * 0.08)),
        }));
      }, TRICKLE_MS);
    };

    const finish = () => {
      clearInterval(trickle);
      current = 'finishing';
      setBar({ phase: 'finishing', progress: 1 });
      resetTimer = setTimeout(() => {
        current = 'idle';
        setBar({ phase: 'idle', progress: 0 });
      }, FINISH_MS + FADE_MS);
    };

    const unsubscribe = subscribeToRequests(() => {
      const busy = getPendingRequests() > 0;
      if (busy) {
        if (current === 'loading' || showTimer) return;
        // A request landing mid-fade restarts the bar at once rather than after the delay.
        const restarting = current === 'finishing';
        clearTimeout(resetTimer);
        // Snap to 0 first (idle has no width transition) so it does not slide backwards.
        if (restarting) setBar({ phase: 'idle', progress: 0 });
        showTimer = setTimeout(start, restarting ? 0 : SHOW_DELAY_MS);
      } else if (showTimer) {
        clearTimeout(showTimer);
        showTimer = undefined;
      } else if (current === 'loading') {
        finish();
      }
    });

    return () => {
      unsubscribe();
      uninstall();
      clearTimeout(showTimer);
      clearTimeout(resetTimer);
      clearInterval(trickle);
    };
  }, []);

  const visible = phase === 'loading';

  return (
    <div
      role="progressbar"
      aria-label="Loading"
      aria-hidden={phase !== 'loading'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      data-state={phase}
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[3px]"
      style={{
        // Finishing holds at 100% for FINISH_MS, then fades before the reset to 0.
        opacity: phase === 'loading' ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease ${phase === 'finishing' ? FINISH_MS : 0}ms`,
      }}
    >
      <div
        className="top-loading-bar h-full"
        style={{
          // Width, not scaleX, so the glowing leading edge is not stretched.
          width: `${progress * 100}%`,
          // Snap back to 0 instantly on reset; glide everywhere else.
          transition: phase === 'idle' ? 'none' : `width ${visible ? TRICKLE_MS * 2 : FINISH_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      />
    </div>
  );
}
