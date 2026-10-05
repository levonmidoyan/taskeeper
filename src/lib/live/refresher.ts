/**
 * The decision LiveRefresh makes on every poll answer and every busy change:
 * refresh only when the server is ahead of what is on screen, and only when the
 * user is idle. Pure, so it is tested without React.
 */
export type Refresher = {
  /** A version from the transport. */
  onVersion(version: number): void;
  /** The version the server rendered into the page (the layout prop). */
  setSeen(version: number): void;
  /** Busy state may have changed. */
  recheck(): void;
};

export function createRefresher({
  seen,
  isBusy,
  refresh,
}: {
  seen: number;
  isBusy: () => boolean;
  refresh: () => void;
}): Refresher {
  let onScreen = seen;
  let latest = seen;

  function flush() {
    if (latest <= onScreen || isBusy()) return;
    // Counted as on screen now, so the refresh's own request (and polls that
    // land during it) do not start a second one.
    onScreen = latest;
    refresh();
  }

  return {
    onVersion(version) {
      if (version > latest) latest = version;
      flush();
    },
    setSeen(version) {
      if (version > onScreen) onScreen = version;
      if (version > latest) latest = version;
    },
    recheck: flush,
  };
}
