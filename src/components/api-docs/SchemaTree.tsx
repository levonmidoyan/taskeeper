import type { SchemaField } from '@/server/api/docs';

/** A request or response schema as a nested field list. */
export function SchemaTree({ fields }: { fields: SchemaField[] }) {
  if (fields.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2 border-l border-stroke-soft-200 pl-4">
      {fields.map((f) => (
        <li key={f.name} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <code className="text-label-sm text-text-strong-950">{f.name}</code>
            <code className="text-paragraph-xs text-text-sub-600 break-all">{f.type}</code>
            {f.required && <span className="text-paragraph-xs text-error-base">required</span>}
          </div>
          {f.description && <p className="text-paragraph-sm text-text-sub-600">{f.description}</p>}
          <SchemaTree fields={f.children} />
        </li>
      ))}
    </ul>
  );
}
