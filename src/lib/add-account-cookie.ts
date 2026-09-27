/**
 * Set while the "Add account" dialog is open, so the auth pages it can hand off
 * to (sign up, forgot password, email code) render for a signed-in user instead
 * of bouncing them home. It only relaxes a convenience redirect, never access,
 * so a client-set cookie is enough. A server component cannot delete a cookie,
 * so it expires on its own rather than being consumed by the first page view.
 */
export const ADD_ACCOUNT_COOKIE = 'taskeeper-add-account';

const MAX_AGE_SECONDS = 10 * 60;

export function setAddAccountCookie() {
  document.cookie = `${ADD_ACCOUNT_COOKIE}=1; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function clearAddAccountCookie() {
  document.cookie = `${ADD_ACCOUNT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
