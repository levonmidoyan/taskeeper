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

`DATABASE_URL` must point at the provider's *pooled* endpoint (`-pooler` in a Neon host, port
6543 on Supabase). The direct endpoint runs out of connections once functions fan out. If a
storage integration filled in the unpooled value, replace it.

### 3. Run migrations

Migrations are not part of the build, so they run from a workstation. Copy the production values
into `.env.production.local` (git-ignored) and run:

```bash
yarn db:migrate:prod
```

Set `DATABASE_URL_DIRECT` in that file to the *direct* (unpooled) endpoint. Migrations issue DDL,
which PgBouncer's transaction pooling cannot carry; `drizzle.config.ts` prefers it over
`DATABASE_URL` whenever it is set.

### 4. Redeploy

Environment variables only reach a new build, so trigger a redeploy after changing them.
