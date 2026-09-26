/**
 * Whether a new account must confirm its email before it gets a session. On by
 * default. The end-to-end suite has no inbox to click a link from, so its
 * server opts out, the same way it opts out of the rate limiter. Read on the
 * server and handed to the client provider, so both sides agree. Prerendered
 * pages bake the client side in at build time, so changing it needs a rebuild.
 */
export function requireEmailVerification(): boolean {
  return process.env.AUTH_EMAIL_VERIFICATION !== 'off';
}

/**
 * Users who are app admins whatever their `role` column says. Bootstraps the
 * first admin, who can then promote others from /admin/users. Comma-separated.
 */
export function adminUserIds(): string[] {
  return (process.env.AUTH_ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Client IDs allowed to start the device authorization flow. Comma-separated.
 * Empty accepts any client ID, which is Better Auth's own default.
 */
export function deviceClientIds(): string[] {
  return (process.env.AUTH_DEVICE_CLIENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
