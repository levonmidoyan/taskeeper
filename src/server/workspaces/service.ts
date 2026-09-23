import { eq } from 'drizzle-orm';
import { db, member, organization, workspaceSettings } from '@/db';
import { newId } from '@/lib/ids';
import { slugify } from '@/lib/slug';

// Every top-level segment that exists under src/app today. A workspace slug
// that matched one of these would be created successfully but never be
// reachable: Next's static route wins over the future `/[slug]` dynamic route
// (Task 10), so the owner would be bounced straight back to the create form.
// Route groups like (app)/(auth) do not contribute a segment of their own.
const RESERVED_SLUGS = new Set(['new-workspace', 'sign-in', 'sign-up', 'api']);

// Disambiguation suffixes are drawn from this alphabet only, never from
// nanoid's default id alphabet (which includes '_' and '-'): slugify promises
// callers a slug matching ^[a-z0-9]+(-[a-z0-9]+)*$, and a raw id slice could
// silently break that invariant (e.g. "acme-_x1y2z" or "acme--ab12c").
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSuffix(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
  }
  return out;
}

async function uniqueSlug(base: string): Promise<string> {
  const [taken] = await db
    .select({ id: organization.id }).from(organization).where(eq(organization.slug, base)).limit(1);
  if (!taken && !RESERVED_SLUGS.has(base)) return base;
  // Suffix rather than a counter: a counter would need a second round-trip per
  // attempt under concurrent creation. Same branch for a real collision and a
  // reserved-word collision — both need the same disambiguation.
  return `${base}-${randomSuffix()}`;
}

/**
 * Takes a userId rather than a WorkspaceContext: this is the one mutation that
 * runs before any workspace exists, so there is no context to pass yet. Never
 * exported from actions.ts directly — an exported ctx-free, userId-taking
 * function on a 'use server' module would let any caller create a workspace
 * owned by another user.
 */
export async function createWorkspaceForUser(userId: string, name: string) {
  const id = newId();
  const slug = await uniqueSlug(slugify(name));

  await db.transaction(async (tx) => {
    await tx.insert(organization).values({ id, name: name.trim(), slug });
    await tx.insert(workspaceSettings).values({ workspaceId: id });
    await tx.insert(member).values({
      id: newId(), organizationId: id, userId, role: 'owner',
    });
  });

  return { id, slug };
}
