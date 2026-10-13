'use client';

import { usePathname, useRouter } from 'next/navigation';
import { projectIdFromPath } from '@/components/shell/palette-actions';
import { useShortcut } from '@/lib/shortcuts/provider';

/** g then a letter: Jira-style jumps. Project views only bind inside a project. */
export function GoToShortcuts({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const base = `/${workspaceSlug}`;
  const projectId = projectIdFromPath(pathname);
  const project = projectId ? `${base}/projects/${projectId}` : null;

  useShortcut('goto.home', () => router.push(base));
  useShortcut('goto.todo', () => router.push(`${base}/todo`));
  useShortcut('goto.calendar', () => router.push(project ? `${project}/calendar` : `${base}/calendar`));
  // The board lives at the project root (/board only redirects there).
  useShortcut('goto.board', () => router.push(project!), project !== null);
  useShortcut('goto.list', () => router.push(`${project}/list`), project !== null);
  useShortcut('goto.summary', () => router.push(`${project}/summary`), project !== null);
  return null;
}
