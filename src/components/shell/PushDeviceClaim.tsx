'use client';

import { useEffect } from 'react';
import { claimPushDevice, currentPushSubscription } from '@/lib/push-device';

/** Once per signed-in load: a subscription left on this browser now delivers to this account. */
export function PushDeviceClaim() {
  useEffect(() => {
    void (async () => {
      try {
        const subscription = await currentPushSubscription();
        if (subscription) await claimPushDevice(subscription);
      } catch {
        // Push is a bonus; nothing to tell the user here.
      }
    })();
  }, []);
  return null;
}
