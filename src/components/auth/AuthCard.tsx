export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full rounded-20 bg-bg-white-0 p-6 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200">
      <div className="mb-6">
        <h1 className="text-title-h5 text-text-strong-950">{title}</h1>
        {description && <p className="mt-1 text-paragraph-sm text-text-sub-600">{description}</p>}
      </div>
      {children}
    </div>
  );
}
