'use client';

import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { ZonePreview } from '@/components/settings/ZonePreview';
import * as Button from '@/components/ui/button';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import * as Select from '@/components/ui/select';
import { zoneOptions } from '@/lib/timezones';
import { settle } from '@/lib/settle';
import { updateUserTimezoneAction } from '@/server/user-settings/actions';

// Radix Select cannot hold an empty value, so "no override" needs a sentinel.
const FOLLOW = 'follow';

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function UserTimezoneForm({ current }: { current: string | null }) {
  const router = useRouter();
  const [choice, setChoice] = useState(current ?? FOLLOW);
  const [pending, setPending] = useState(false);
  // The browser zone only exists on the client.
  const localZone = useSyncExternalStore(() => () => {}, browserZone, () => null);

  const saved = current ?? FOLLOW;
  const options = zoneOptions(choice === FOLLOW ? current : choice);

  async function onSave() {
    setPending(true);
    const result = await settle(updateUserTimezoneAction(choice === FOLLOW ? null : choice));
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Timezone updated.');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200">
      <div className="flex flex-col gap-1">
        <Label.Root htmlFor="user-timezone">Your timezone</Label.Root>
        <Select.Root value={choice} onValueChange={setChoice} disabled={pending}>
          <Select.Trigger id="user-timezone" className="w-full sm:w-72" aria-describedby="user-timezone-hint">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value={FOLLOW}>Follow each workspace&rsquo;s timezone</Select.Item>
            {options.map((zone) => <Select.Item key={zone} value={zone}>{zone}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Hint.Root id="user-timezone-hint">
          Due dates and &ldquo;today&rdquo; are shown in this timezone in every workspace.
        </Hint.Root>
      </div>

      {localZone && localZone !== choice && (
        <div>
          <Button.Root size="small" variant="neutral" mode="stroke" onClick={() => setChoice(localZone)} disabled={pending}>
            Use {localZone}
          </Button.Root>
        </div>
      )}

      {choice !== FOLLOW && <ZonePreview label="Chosen time" zone={choice} />}

      <div>
        <Button.Root size="small" onClick={onSave} disabled={pending || choice === saved}>
          {pending ? 'Saving…' : 'Save'}
        </Button.Root>
      </div>
    </div>
  );
}
