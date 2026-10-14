'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as Button from '@/components/ui/button';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import * as Switch from '@/components/ui/switch';
import type { PushPrefs } from '@/lib/push';
import { pushSupport, urlBase64ToUint8Array } from '@/lib/push-client';
import { claimPushDevice, currentPushSubscription, pushRegistration } from '@/lib/push-device';
import { settle } from '@/lib/settle';
import {
  sendTestPushAction, subscribePushAction, unsubscribePushAction, updatePushPrefsAction,
} from '@/server/push/actions';

type DeviceState = 'loading' | 'unconfigured' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const KINDS: Array<{ key: keyof PushPrefs; label: string; hint: string }> = [
  { key: 'reminders', label: 'Reminders', hint: 'Reminders you set on tasks.' },
  { key: 'mentions', label: 'Mentions', hint: 'When someone @mentions you.' },
  { key: 'taskChanges', label: 'Task changes', hint: 'Edits, comments and reactions on your tasks.' },
  { key: 'projectChanges', label: 'Project changes', hint: 'Projects renamed, archived or deleted.' },
];

const DEVICE_HINT: Record<DeviceState, string> = {
  loading: 'Checking this device…',
  unconfigured: 'Push is not set up on this server.',
  unsupported: 'This browser can’t receive push notifications.',
  'ios-install': 'On iPhone and iPad, add Taskeeper to your Home Screen first (Share → Add to Home Screen), then open it from there.',
  denied: 'Notifications are blocked. Allow them for this site in your browser settings.',
  off: 'Get notifications on this device, even when Taskeeper is closed.',
  on: 'This device gets push notifications.',
};

export function PushPrefsForm({ current, publicKey }: { current: PushPrefs; publicKey: string | null }) {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceState>('loading');
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState(current);
  const unchanged = KINDS.every(({ key }) => prefs[key] === current[key]);

  useEffect(() => {
    void (async () => {
      if (!publicKey) return setDevice('unconfigured');
      const support = pushSupport({
        hasServiceWorker: 'serviceWorker' in navigator,
        hasPushManager: 'PushManager' in window,
        userAgent: navigator.userAgent,
        standalone: matchMedia('(display-mode: standalone)').matches,
      });
      if (support !== 'ok') return setDevice(support);
      if (Notification.permission === 'denied') return setDevice('denied');
      const subscription = await currentPushSubscription();
      // Shown On only once it delivers to this account (it may be another account's).
      setDevice(subscription && (await claimPushDevice(subscription)) ? 'on' : 'off');
    })();
  }, [publicKey]);

  async function toggleDevice(on: boolean) {
    if (!publicKey) return;
    setBusy(true);
    try {
      const registration = await pushRegistration();
      if (on) {
        // Asked from the tap: iOS refuses a permission prompt that no gesture started.
        if ((await Notification.requestPermission()) !== 'granted') return setDevice('denied');
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const result = await settle(subscribePushAction(subscription.toJSON()));
        if (!result.ok) {
          await subscription.unsubscribe();
          return void toast.error(result.error);
        }
        setDevice('on');
      } else {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await settle(unsubscribePushAction(subscription.endpoint));
          await subscription.unsubscribe();
        }
        setDevice('off');
      }
    } catch (error) {
      console.error(error);
      toast.error('Could not change push on this device.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    const result = await settle(updatePushPrefsAction(prefs));
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success('Push settings updated.');
    router.refresh();
  }

  async function test() {
    setBusy(true);
    const result = await settle(sendTestPushAction());
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success(result.data.sent === 1 ? 'Test sent.' : `Test sent to ${result.data.sent} devices.`);
  }

  const switchable = device === 'on' || device === 'off';

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label.Root htmlFor="push-device">Push on this device</Label.Root>
          <Hint.Root id="push-device-hint">{DEVICE_HINT[device]}</Hint.Root>
        </div>
        <Switch.Root
          id="push-device"
          aria-describedby="push-device-hint"
          checked={device === 'on'}
          onCheckedChange={toggleDevice}
          disabled={busy || !switchable}
        />
      </div>

      {KINDS.map(({ key, label, hint }) => (
        <div key={key} className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label.Root htmlFor={`push-${key}`}>{label}</Label.Root>
            <Hint.Root>{hint}</Hint.Root>
          </div>
          <Switch.Root
            id={`push-${key}`}
            checked={prefs[key]}
            onCheckedChange={(v) => setPrefs((p) => ({ ...p, [key]: v }))}
            disabled={busy || !publicKey}
          />
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button.Root size="small" onClick={save} disabled={busy || unchanged}>Save</Button.Root>
        <Button.Root size="small" variant="neutral" mode="stroke" onClick={test} disabled={busy || device !== 'on'}>
          Send test
        </Button.Root>
      </div>
    </div>
  );
}
