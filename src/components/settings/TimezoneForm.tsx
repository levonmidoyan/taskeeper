'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ZonePreview } from '@/components/settings/ZonePreview';
import * as Button from '@/components/ui/button';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import * as Select from '@/components/ui/select';
import { updateWorkspaceSettingsAction } from '@/server/settings/actions';

// A short curated list. Intl.supportedValuesOf('timeZone') has ~400 entries,
// which is a worse control than a handful of relevant ones.
const ZONES = [
  'Asia/Yerevan', 'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Tokyo',
];

export function TimezoneForm({
  workspaceSlug,
  current,
  canEdit,
}: {
  workspaceSlug: string;
  current: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(current);
  const [pending, setPending] = useState(false);

  async function onSave() {
    setPending(true);
    const result = await updateWorkspaceSettingsAction(workspaceSlug, { timezone });
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
        <Label.Root htmlFor="timezone">Workspace timezone</Label.Root>
        <Select.Root value={timezone} onValueChange={setTimezone} disabled={!canEdit || pending}>
          <Select.Trigger id="timezone" className="w-full sm:w-72" aria-describedby="timezone-hint">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {ZONES.map((zone) => <Select.Item key={zone} value={zone}>{zone}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Hint.Root id="timezone-hint">
          Due dates and “today” are calculated in this timezone for everyone in the workspace.
        </Hint.Root>
      </div>

      <ZonePreview workspaceZone={timezone} />

      {canEdit && (
        <div>
          <Button.Root size="small" onClick={onSave} disabled={pending || timezone === current}>
            {pending ? 'Saving…' : 'Save'}
          </Button.Root>
        </div>
      )}
    </div>
  );
}
