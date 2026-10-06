import * as Badge from '@/components/ui/badge';
import { errorCodes, type Endpoint, type HttpMethod } from '@/server/api/contract/types';
import { curlExample, jsonSchemaOf, parameterRows, schemaFields } from '@/server/api/docs';
import { ERROR_DESCRIPTIONS, ERROR_STATUS } from '@/server/api/errors';
import { SchemaTree } from './SchemaTree';

const METHOD_COLOR: Record<HttpMethod, 'sky' | 'green' | 'orange' | 'red'> = {
  GET: 'sky', POST: 'green', PATCH: 'orange', DELETE: 'red',
};

export function MethodBadge({ method }: { method: HttpMethod }) {
  return <Badge.Root variant="lighter" color={METHOD_COLOR[method]} size="medium">{method}</Badge.Root>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h4 className="text-label-sm text-text-strong-950">{children}</h4>;
}

export function EndpointSection({ endpoint, origin }: { endpoint: Endpoint; origin: string }) {
  const params = parameterRows(endpoint);
  return (
    <section id={endpoint.operationId} className="scroll-mt-6 flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200">
      <div className="flex flex-col gap-2">
        <h3 className="text-label-lg text-text-strong-950">{endpoint.summary}</h3>
        <div className="flex min-w-0 items-center gap-2">
          <MethodBadge method={endpoint.method} />
          <code className="min-w-0 break-all text-paragraph-sm text-text-sub-600">/api/v1{endpoint.path}</code>
        </div>
        <p className="text-paragraph-sm text-text-sub-600">{endpoint.description}</p>
      </div>

      {params.length > 0 && (
        <div className="flex flex-col gap-2">
          <Heading>Parameters</Heading>
          <div className="relative overflow-x-auto rounded-xl ring-1 ring-inset ring-stroke-soft-200">
            <table className="w-full min-w-[32rem] border-collapse text-paragraph-sm">
              <thead className="bg-bg-weak-50">
                <tr className="text-left text-label-xs uppercase text-text-soft-400">
                  <th scope="col" className="px-3 py-2 font-medium">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium">In</th>
                  <th scope="col" className="px-3 py-2 font-medium">Type</th>
                  <th scope="col" className="px-3 py-2 font-medium">Required</th>
                  <th scope="col" className="px-3 py-2 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {params.map((p) => (
                  <tr key={`${p.in}-${p.name}`} className="border-t border-stroke-soft-200 align-top">
                    <td className="px-3 py-2"><code>{p.name}</code></td>
                    <td className="px-3 py-2 text-text-sub-600">{p.in}</td>
                    <td className="px-3 py-2"><code className="break-all text-text-sub-600">{p.type}</code></td>
                    <td className="px-3 py-2 text-text-sub-600">{p.required ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2 text-text-sub-600">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {endpoint.body && (
        <div className="flex flex-col gap-2">
          <Heading>Request body</Heading>
          <SchemaTree fields={schemaFields(jsonSchemaOf(endpoint.body, 'input'))} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Heading>Response · {endpoint.status}</Heading>
        {endpoint.response
          ? <SchemaTree fields={schemaFields(jsonSchemaOf(endpoint.response, 'output'))} />
          : <p className="text-paragraph-sm text-text-sub-600">No body.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Heading>Example</Heading>
        <pre className="overflow-x-auto rounded-xl bg-bg-weak-50 p-3 text-paragraph-xs text-text-strong-950"><code>{curlExample(endpoint, origin)}</code></pre>
      </div>

      <div className="flex flex-col gap-2">
        <Heading>Errors</Heading>
        <ul className="flex flex-col gap-1 text-paragraph-sm text-text-sub-600">
          {errorCodes(endpoint).map((code) => (
            <li key={code}><code className="text-text-strong-950">{ERROR_STATUS[code]} {code}</code> — {ERROR_DESCRIPTIONS[code]}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
