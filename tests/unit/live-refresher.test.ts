import { describe, expect, it, vi } from 'vitest';
import { createRefresher } from '@/lib/live/refresher';

function make(seen = 5) {
  const state = { busy: false };
  const refresh = vi.fn();
  const r = createRefresher({ seen, isBusy: () => state.busy, refresh });
  return { r, state, refresh };
}

describe('createRefresher', () => {
  it('does nothing when the polled version is the one on screen', () => {
    const { r, refresh } = make(5);
    r.onVersion(5);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once when a newer version arrives and the page is idle', () => {
    const { r, refresh } = make(5);
    r.onVersion(6);
    r.onVersion(6);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('defers while busy and collapses several changes into one refresh', () => {
    const { r, state, refresh } = make(5);
    state.busy = true;
    r.onVersion(6);
    r.onVersion(7);
    r.onVersion(8);
    r.recheck();
    expect(refresh).not.toHaveBeenCalled();

    state.busy = false;
    r.recheck();
    r.recheck();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('skips the refresh when my own edit already brought the page up to date', () => {
    const { r, state, refresh } = make(5);
    state.busy = true; // my save is in flight; the poll already sees its bump
    r.onVersion(6);
    r.setSeen(6); // the save's response re-rendered the layout with version 6
    state.busy = false;
    r.recheck();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes again for a later change', () => {
    const { r, refresh } = make(5);
    r.onVersion(6);
    r.setSeen(6);
    r.onVersion(7);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('ignores an older version arriving late', () => {
    const { r, refresh } = make(5);
    r.setSeen(9);
    r.onVersion(8);
    expect(refresh).not.toHaveBeenCalled();
  });
});
