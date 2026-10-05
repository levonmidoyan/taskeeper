import type { Metadata } from 'next';
import Link from 'next/link';
import { DocsIndex } from '@/components/api-docs/DocsIndex';
import { EndpointSection } from '@/components/api-docs/EndpointSection';
import { API_RATE_LIMIT, API_RATE_WINDOW_SECONDS } from '@/lib/api-tokens';
import { appUrl } from '@/lib/url';
import { endpoints } from '@/server/api/contract';
import { groupEndpoints } from '@/server/api/docs';
import { API_ERROR_CODES, ERROR_DESCRIPTIONS, ERROR_STATUS } from '@/server/api/errors';

export const metadata: Metadata = {
  title: 'API reference · Taskeeper',
  description: 'The Taskeeper REST API: authentication, errors, pagination and every endpoint.',
};

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-label-md text-text-strong-950">{title}</h3>
      <div className="flex flex-col gap-2 text-paragraph-sm text-text-sub-600">{children}</div>
    </div>
  );
}

/** Public. Rendered from the same contract the API validates against. */
export default function ApiDocsPage() {
  const origin = appUrl();
  const groups = groupEndpoints(endpoints);

  return (
    <div className="min-h-dvh bg-bg-weak-50">
      <header className="border-b border-stroke-soft-200 bg-bg-white-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 lg:px-6">
          <Link href="/" className="text-label-md text-text-strong-950">Taskeeper</Link>
          <a href="/api/v1/openapi.json" download className="text-label-sm text-primary-base hover:underline">openapi.json</a>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start lg:gap-8 lg:px-6">
        <DocsIndex groups={groups} />

        <main className="flex min-w-0 flex-1 flex-col gap-8">
          <section id="overview" className="scroll-mt-6 flex flex-col gap-6">
            <div>
              <h1 className="text-title-h5 text-text-strong-950">API reference</h1>
              <p className="mt-1 text-paragraph-sm text-text-sub-600">
                Drive Taskeeper from scripts and integrations. Every call acts as you, with your role in the workspace,
                and shows up in activity and on teammates’ screens like a change made in the app.
              </p>
            </div>

            <Block title="Base URL">
              <code className="break-all text-text-strong-950">{origin}/api/v1</code>
            </Block>

            <Block title="Authentication">
              <p>
                Create a token in <Link href="/settings/api-tokens" className="text-primary-base hover:underline">Account → API tokens</Link> and
                send it on every request:
              </p>
              <pre className="overflow-x-auto rounded-xl bg-bg-white-0 p-3 text-paragraph-xs text-text-strong-950 ring-1 ring-inset ring-stroke-soft-200"><code>Authorization: Bearer tk_…</code></pre>
              <p>Tokens keep working after you sign out, until you revoke them or they expire.</p>
            </Block>

            <Block title="Rate limit">
              <p>
                {API_RATE_LIMIT} requests per {API_RATE_WINDOW_SECONDS} seconds per token. Over the limit you get 429
                with a <code>Retry-After</code> header in seconds.
              </p>
            </Block>

            <Block title="Errors">
              <p>Every error has the same body; <code>issues</code> appears only on invalid_request.</p>
              <pre className="overflow-x-auto rounded-xl bg-bg-white-0 p-3 text-paragraph-xs text-text-strong-950 ring-1 ring-inset ring-stroke-soft-200"><code>{'{ "error": { "code": "invalid_request", "message": "…", "issues": [{ "path": "body.title", "message": "…" }] } }'}</code></pre>
              <ul className="flex flex-col gap-1">
                {API_ERROR_CODES.map((code) => (
                  <li key={code}><code className="text-text-strong-950">{ERROR_STATUS[code]} {code}</code> — {ERROR_DESCRIPTIONS[code]}</li>
                ))}
              </ul>
            </Block>

            <Block title="Pagination">
              <p>
                The task list returns <code>{'{ data, nextCursor }'}</code>. Pass <code>nextCursor</code> back as <code>cursor</code> until
                it is null. Pages are offset-based, so a task created or changed between two requests can be skipped or repeated.
              </p>
            </Block>

            <Block title="Formats">
              <p>JSON in camelCase. <code>dueDate</code> is a calendar day, <code>YYYY-MM-DD</code>. Timestamps are ISO-8601 in UTC.</p>
            </Block>
          </section>

          {groups.map(({ group, endpoints: list }) => (
            <section key={group} className="flex flex-col gap-4">
              <h2 className="text-title-h6 text-text-strong-950">{group}</h2>
              {list.map((e) => <EndpointSection key={e.operationId} endpoint={e} origin={origin} />)}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
