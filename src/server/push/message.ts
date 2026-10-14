import { bellHref, bellText, type BellItem } from '@/lib/notifications';

export type PushPayload = { title: string; body: string; url: string; tag: string };

const BODY_MAX = 180;

/** What the phone shows: the bell's own copy and link, tagged so a merged update replaces the earlier banner. */
export function pushMessage(slug: string, item: BellItem & { id: string }): PushPayload {
  const { title, detail } = bellText(item);
  const body = detail.length > BODY_MAX ? `${detail.slice(0, BODY_MAX - 1)}…` : detail;
  return { title, body, url: bellHref(slug, item), tag: item.id };
}
