'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import * as Button from '@/components/ui/button';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import * as Select from '@/components/ui/select';
import * as Switch from '@/components/ui/switch';
import { hourLabel, REMINDER_CRON_HOURLY } from '@/lib/reminders';
import { settle } from '@/lib/settle';
import { updateReminderPrefsAction } from '@/server/user-settings/actions';
import type { ReminderPrefs } from '@/server/user-settings/service';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function ReminderPrefsForm({ current }: { current: ReminderPrefs }) {
  const router = useRouter();
  const [digestEnabled, setDigestEnabled] = useState(current.digestEnabled);
  const [reminderHour, setReminderHour] = useState(current.reminderHour);
  const [changeNotify, setChangeNotify] = useState(current.changeNotify);
  const [changeSound, setChangeSound] = useState(current.changeSound);
  const [pending, setPending] = useState(false);

  const unchanged = digestEnabled === current.digestEnabled
    && reminderHour === current.reminderHour
    && changeNotify === current.changeNotify
    && changeSound === current.changeSound;

  async function onSave() {
    setPending(true);
    const result = await settle(updateReminderPrefsAction({ digestEnabled, reminderHour, changeNotify, changeSound }));
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Notification settings updated.');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label.Root htmlFor="change-notify">Changes by teammates</Label.Root>
          <Hint.Root>
            Bell and pop-up when someone changes a task you created or are assigned, or renames, archives or deletes a project.
          </Hint.Root>
        </div>
        <Switch.Root id="change-notify" checked={changeNotify} onCheckedChange={setChangeNotify} disabled={pending} />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label.Root htmlFor="change-sound">Play a sound</Label.Root>
          <Hint.Root>A short chime with those pop-ups.</Hint.Root>
        </div>
        <Switch.Root
          id="change-sound"
          checked={changeSound}
          onCheckedChange={setChangeSound}
          disabled={pending || !changeNotify}
        />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label.Root htmlFor="digest-enabled">Daily digest</Label.Root>
          <Hint.Root>An email and a bell item listing your tasks due today and overdue.</Hint.Root>
        </div>
        <Switch.Root id="digest-enabled" checked={digestEnabled} onCheckedChange={setDigestEnabled} disabled={pending} />
      </div>

      <div className="flex flex-col gap-1">
        <Label.Root htmlFor="reminder-hour">Reminder time</Label.Root>
        <Select.Root value={String(reminderHour)} onValueChange={(v) => setReminderHour(Number(v))} disabled={pending}>
          <Select.Trigger id="reminder-hour" className="w-full sm:w-40" aria-describedby="reminder-hour-hint">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {HOURS.map((h) => <Select.Item key={h} value={String(h)}>{hourLabel(h)}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Hint.Root id="reminder-hour-hint">
          Your local time, for the digest and for reminders you set on tasks.
          {!REMINDER_CRON_HOURLY && ' Delivered once a day on the current plan.'}
        </Hint.Root>
      </div>

      <div>
        <Button.Root size="small" onClick={onSave} disabled={pending || unchanged}>
          {pending ? 'Saving…' : 'Save'}
        </Button.Root>
      </div>
    </div>
  );
}
