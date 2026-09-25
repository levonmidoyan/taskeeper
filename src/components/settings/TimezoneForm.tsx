'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/legacy-ui/button';
import { Label } from '@/components/legacy-ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/legacy-ui/select';
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
    <div className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card p-4">
      <div className="space-y-2">
        <Label htmlFor="timezone">Workspace timezone</Label>
        <Select value={timezone} onValueChange={setTimezone} disabled={!canEdit || pending}>
          <SelectTrigger id="timezone" className="h-11 w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ZONES.map((zone) => <SelectItem key={zone} value={zone}>{zone}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Due dates and “today” are calculated in this timezone for everyone in the workspace.
        </p>
      </div>

      {canEdit && (
        <Button onClick={onSave} disabled={pending || timezone === current} className="h-11">
          {pending ? 'Saving…' : 'Save'}
        </Button>
      )}
    </div>
  );
}
