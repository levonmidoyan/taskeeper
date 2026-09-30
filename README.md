This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

### 1. Provision Postgres

In the Vercel dashboard: **Storage** -> **Create Database** -> Postgres, then connect it to the
project. Any hosted Postgres works (Neon, Supabase, Railway); nothing here is provider-specific.

### 2. Environment variables

Set these under **Settings -> Environment Variables** for Production and Preview:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Pooled connection string, with `?sslmode=require` |
| `DATABASE_POOL_MAX` | `1` — every serverless instance opens its own pool |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Public origin of the deployment |
| `RESEND_API_KEY` | Resend key, or empty to log invitation and verification emails |
| `TZ` | `UTC` |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | R2 bucket name, or empty to turn attachments off |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | R2 API token (Object Read & Write, this bucket only) |

`DATABASE_URL` must point at the provider's *pooled* endpoint (`-pooler` in a Neon host, port
6543 on Supabase). The direct endpoint runs out of connections once functions fan out. If a
storage integration filled in the unpooled value, replace it.

### Attachments on Cloudflare R2

1. R2 → **Create bucket**. Leave public access off; the app only ever hands out five-minute signed links.
2. R2 → **Manage API tokens** → create a token with **Object Read & Write** scoped to that bucket. Its access key id and secret go in `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
3. Bucket → **Settings → CORS policy**, so browsers can upload straight to the bucket:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-app.example.com"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Add every origin that uploads from: each Preview deployment origin (`*.vercel.app`) and `http://localhost:3000` if local development uses R2.

4. Uploads that never finish and files of deleted tasks stay in the bucket until swept:
   `SWEEP_ENV_FILE=.env.production.local yarn attachments:sweep` (add `--dry-run` to preview). Run it daily or weekly.

Locally, `yarn db:up` also starts MinIO; run `yarn storage:init` once to create the buckets.

### 3. Create tables and seed

v1 has no migrations: `yarn db:setup` creates every table straight from `src/db/schema`, then
applies the triggers in `src/db/sql` (which `drizzle-kit push` does not manage), and
`yarn db:seed` adds the super admin from `SEED_ADMIN_NAME` / `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`. Neither is part of the build, so they run from a workstation. Copy the
production values into `.env.production.local` (git-ignored) and run:

```bash
yarn db:setup:prod
SEED_ENV_FILE=.env.production.local yarn db:seed
```

The seed prints the admin's id as `AUTH_ADMIN_USER_IDS=<id>`; set that variable in Vercel.

Set `DATABASE_URL_DIRECT` in that file to the *direct* (unpooled) endpoint. Creating tables issues
DDL, which PgBouncer's transaction pooling cannot carry; `drizzle.config.ts` prefers it over
`DATABASE_URL` whenever it is set. The seed is safe to rerun: an existing account with that
email is promoted to admin rather than duplicated.

Locally: `yarn db:up`, then `yarn db:init` (tables + seed) and `yarn db:setup:test`. Copy the
printed `AUTH_ADMIN_USER_IDS` line into `.env.local`.

### 4. Redeploy

Environment variables only reach a new build, so trigger a redeploy after changing them.
