'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import * as Badge from '@/components/ui/badge';
import * as Button from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatDueDate, formatInZone, todayInZone } from '@/lib/dates';
import { settle } from '@/lib/settle';
import { revokeApiTokenAction } from '@/server/api-tokens/actions';
import type { ApiTokenRow } from '@/server/api-tokens/service';

/** Relative day, exact time on hover — the attachment cards' pattern. */
function Day({ at, timezone }: { at: Date; timezone: string }) {
  return (
    <time dateTime={at.toISOString()} title={formatInZone(at, timezone)}>
      {formatDueDate(todayInZone(timezone, at), timezone)}
    </time>
  );
}

export function ApiTokenTable({ tokens, timezone }: { tokens: ApiTokenRow[]; timezone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  async function onRevoke(token: ApiTokenRow) {
    const ok = await confirm({
      title: `Revoke ${token.name}?`,
      description: 'Anything using it stops working at once. This cannot be undone.',
      confirmLabel: 'Revoke',
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await settle(revokeApiTokenAction(token.id));
      if (!result.ok) toast.error(result.error);
      else toast.success(`${token.name} revoked.`);
      router.refresh();
    });
  }

  if (tokens.length === 0) {
    return <p className="rounded-2xl p-5 text-paragraph-sm text-text-sub-600 ring-1 ring-inset ring-stroke-soft-200">No tokens yet.</p>;
  }

  // Same stacking approach as MemberTable: rows wrap below sm instead of scrolling sideways.
  return (
    <div className="relative overflow-x-auto rounded-2xl ring-1 ring-inset ring-stroke-soft-200">
      <table className="w-full border-collapse text-paragraph-sm sm:min-w-[40rem]">
        <thead className="bg-bg-weak-50 max-sm:sr-only">
          <tr className="text-left text-label-xs uppercase text-text-soft-400">
            <th scope="col" className="px-4 py-2 font-medium">Name</th>
            <th scope="col" className="px-4 py-2 font-medium">Created</th>
            <th scope="col" className="px-4 py-2 font-medium">Last used</th>
            <th scope="col" className="px-4 py-2 font-medium">Expires</th>
            <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.id} className="border-t border-stroke-soft-200 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-4 max-sm:pb-3 max-sm:first:border-t-0">
              <td className="px-4 py-3 max-sm:basis-full">
                <div className="text-label-sm text-text-strong-950">{t.name}</div>
                <code className="text-paragraph-xs text-text-sub-600">{t.prefix}…</code>
              </td>
              <td className="px-4 py-3 text-text-sub-600 max-sm:py-0"><span className="sm:hidden">Created </span><Day at={t.createdAt} timezone={timezone} /></td>
              <td className="px-4 py-3 text-text-sub-600 max-sm:py-0">
                <span className="sm:hidden">Used </span>{t.lastUsedAt ? <Day at={t.lastUsedAt} timezone={timezone} /> : 'Never'}
              </td>
              <td className="px-4 py-3 text-text-sub-600 max-sm:py-0">
                {t.expired
                  ? <Badge.Root variant="lighter" color="red" size="medium">Expired</Badge.Root>
                  : t.expiresAt ? <><span className="sm:hidden">Expires </span><Day at={t.expiresAt} timezone={timezone} /></> : 'Never expires'}
              </td>
              <td className="px-4 py-3 text-right max-sm:ml-auto max-sm:py-0">
                <Button.Root variant="error" mode="ghost" size="xsmall" disabled={pending} onClick={() => onRevoke(t)} aria-label={`Revoke ${t.name}`}>
                  Revoke
                </Button.Root>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
