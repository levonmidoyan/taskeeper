/** Client-safe: the settings UI, the docs page and the server all read these. */
export const API_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;
export type ApiTokenExpiryDays = (typeof API_TOKEN_EXPIRY_DAYS)[number];
export const DEFAULT_API_TOKEN_EXPIRY_DAYS: ApiTokenExpiryDays = 90;
export const MAX_ACTIVE_API_TOKENS = 20;
export const API_TOKEN_NAME_MAX = 60;

/** Requests per token per fixed window (spec §3). */
export const API_RATE_LIMIT = 120;
export const API_RATE_WINDOW_SECONDS = 60;
