/**
 * True from a live refresh's start until its version is on screen, so a card can
 * tell at mount whether a teammate added it (LiveRefresh sets and clears it).
 */
let remote = false;

export function markRemoteRefresh() {
  remote = true;
}

export function clearRemoteRefresh() {
  remote = false;
}

export function isRemoteRefresh(): boolean {
  return remote;
}
