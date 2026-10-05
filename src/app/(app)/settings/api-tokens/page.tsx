import Link from 'next/link';
import { ApiTokenTable } from '@/components/settings/ApiTokenTable';
import { NewApiTokenDialog } from '@/components/settings/NewApiTokenDialog';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { requireUser } from '@/lib/session';
import { resolveShellWorkspace } from '@/lib/shell-workspace';
import { listApiTokens } from '@/server/api-tokens/service';

// A static segment, so it wins over settings/[path] (which only knows auth views).
export default async function ApiTokensPage() {
  const ctx = await requireUser();
  const [tokens, shell] = await Promise.all([listApiTokens(ctx), resolveShellWorkspace(ctx.userId)]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-label-lg text-text-strong-950">API tokens</h2>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">
            Tokens let scripts and integrations use Taskeeper as you, in every workspace you belong to.
            They keep working after you sign out, until you revoke them or they expire.
            See the <Link href="/docs/api" className="text-primary-base hover:underline">API reference</Link>.
          </p>
        </div>
        <NewApiTokenDialog />
      </div>
      <ApiTokenTable tokens={tokens} timezone={shell?.timezone ?? DEFAULT_TIMEZONE} />
    </div>
  );
}
