import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { organization } from 'better-auth/plugins';
import { db } from '@/db';
import * as schema from '@/db/schema';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  // On by default, and it must stay on in production — it is what stops
  // credential stuffing against sign-in. The end-to-end suite signs up several
  // accounts in a row from one address and trips it, so the test runner opts
  // out explicitly rather than the app guessing from NODE_ENV: the e2e run is a
  // production build, so NODE_ENV cannot tell the two apart.
  rateLimit: { enabled: process.env.AUTH_RATE_LIMIT !== 'off' },
  plugins: [
    organization(),
    // nextCookies must be last: it wraps the response so Server Actions can set
    // cookies. Any plugin after it would not have its cookies applied.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
