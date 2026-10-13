'use client';

import { fileToAvatarDataUrl, resizeAvatar } from '@better-auth-ui/core';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { WorkspaceTile } from '@/components/shell/WorkspaceTile';
import * as Button from '@/components/ui/button';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import { settle } from '@/lib/settle';
import { updateWorkspaceLogoAction } from '@/server/settings/actions';

/** Twice the largest tile, so it stays sharp on high-density screens. */
const LOGO_SIZE = 128;

export function WorkspaceLogoForm({
  workspaceSlug,
  workspaceId,
  name,
  current,
  canEdit,
}: {
  workspaceSlug: string;
  workspaceId: string;
  name: string;
  current: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);

  async function save(logo: string | null) {
    setPending(true);
    const result = await settle(updateWorkspaceLogoAction(workspaceSlug, logo));
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(logo ? 'Workspace icon updated.' : 'Workspace icon removed.');
    router.refresh();
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    let logo: string;
    try {
      logo = await fileToAvatarDataUrl(await resizeAvatar(file, LOGO_SIZE, 'webp'));
    } catch {
      toast.error('That image could not be read.');
      return;
    }
    await save(logo);
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200">
      <div className="flex flex-col gap-1">
        <Label.Root htmlFor="workspace-logo">Workspace icon</Label.Root>
        <Hint.Root id="workspace-logo-hint">
          Shown in the workspace switcher. Square images work best.
        </Hint.Root>
      </div>

      <div className="flex items-center gap-4">
        <WorkspaceTile id={workspaceId} name={name} logo={current} className="size-14 rounded-xl text-title-h5" />

        {canEdit && (
          <div className="flex gap-2">
            <input
              ref={inputRef}
              id="workspace-logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-describedby="workspace-logo-hint"
              className="hidden"
              onChange={onFile}
            />
            <Button.Root
              size="small"
              variant="neutral"
              mode="stroke"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
            >
              {pending ? 'Saving…' : current ? 'Replace' : 'Upload'}
            </Button.Root>
            {current && (
              <Button.Root size="small" variant="error" mode="ghost" onClick={() => save(null)} disabled={pending}>
                Remove
              </Button.Root>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
