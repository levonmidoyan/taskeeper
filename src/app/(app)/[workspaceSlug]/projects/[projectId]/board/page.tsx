import { redirect } from 'next/navigation';

// The board moved to the project root; keep old /board links working.
export default async function LegacyBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const { task } = await searchParams;
  const query = task ? `?task=${encodeURIComponent(task)}` : '';
  redirect(`/${workspaceSlug}/projects/${projectId}${query}`);
}
