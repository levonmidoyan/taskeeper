/**
 * Routes outside a workspace (account settings) still render the workspace
 * rail, so they need to know which workspace the user came from. Plain module:
 * both the client writer and the server reader import it.
 */
export const LAST_WORKSPACE_COOKIE = 'last-workspace';
