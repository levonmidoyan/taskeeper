import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createWorkspace, joinWorkspace } from '../setup/factories';
import { auth } from '@/lib/auth';
import { appUrl } from '@/lib/url';
import { member, organization, user } from '@/db';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
afterAll(closeDb);

const base = `${appUrl()}/api/auth`;

/** A real HTTP round trip through the auth router, as a browser would make it. */
function call(path: string, body: unknown, cookie?: string) {
  return auth.handler(
    new Request(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: appUrl(),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

async function signedIn(email: string) {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  await auth.api.signUpEmail({ body: { name: email, email, password: 'correct-horse' } });
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  // Signed in through auth.api, not the router, so the sign-in rate limit is
  // not tripped by several accounts in one test.
  const { headers } = await auth.api.signInEmail({
    body: { email, password: 'correct-horse' },
    returnHeaders: true,
  });
  const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return { id: row.id, cookie };
}

// The app manages workspaces through its own services (src/server/members,
// src/server/workspaces), which enforce its role rules and create the settings
// row. The organization plugin's own endpoints would bypass all of that.
describe('organization plugin endpoints', () => {
  it('cannot be used by an admin to change member roles', async () => {
    const owner = await signedIn('owner@example.com');
    const admin = await signedIn('admin@example.com');
    const plain = await signedIn('plain@example.com');
    const ws = await createWorkspace(owner.id, 'Acme', 'acme');
    await joinWorkspace(admin.id, ws.id, 'admin');
    const joined = await joinWorkspace(plain.id, ws.id, 'member');

    // Only an owner changes roles in the app (spec §4).
    const res = await call(
      '/organization/update-member-role',
      { memberId: joined.id, role: 'admin', organizationId: ws.id },
      admin.cookie,
    );

    expect(res.status).toBe(404);
    const [after] = await db.select({ role: member.role }).from(member).where(eq(member.id, joined.id));
    expect(after.role).toBe('member');
  });

  it('cannot create a workspace outside the app flow', async () => {
    const someone = await signedIn('someone@example.com');

    const res = await call('/organization/create', { name: 'Admin', slug: 'admin' }, someone.cookie);

    expect(res.status).toBe(404);
    expect(await db.select().from(organization)).toHaveLength(0);
  });

  it('leaves the rest of the auth API reachable', async () => {
    const someone = await signedIn('reach@example.com');

    const res = await auth.handler(
      new Request(`${base}/get-session`, { headers: { cookie: someone.cookie, origin: appUrl() } }),
    );

    expect(res.status).toBe(200);
    expect((await res.json())?.user?.email).toBe('reach@example.com');
  });
});
