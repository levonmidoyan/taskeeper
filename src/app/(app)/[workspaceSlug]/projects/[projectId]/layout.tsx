import { ViewSwitchTransition } from '@/components/shell/ViewSwitchTransition';

/**
 * Crossfades between a project's views (Board, List, Summary, Calendar, saved
 * views). Here, not in each page: a page's content is inserted inside its new
 * <main>, and React plays enter / exit only for a boundary above every DOM node
 * it inserts. The header crossfades onto identical pixels, so it stays still.
 */
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return <ViewSwitchTransition>{children}</ViewSwitchTransition>;
}
