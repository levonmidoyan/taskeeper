'use client';

import { useState } from 'react';

/**
 * Local state for a field the server also holds. When a refresh brings a new
 * server value (a teammate's edit, via live refresh), it replaces the local one,
 * unless the local one has an edit of its own not yet saved.
 */
export function useServerValue<T>(server: T) {
  const [value, setValue] = useState(server);
  const [synced, setSynced] = useState(server);
  if (server !== synced) {
    setSynced(server);
    if (value === synced) setValue(server);
  }
  return [value, setValue] as const;
}
