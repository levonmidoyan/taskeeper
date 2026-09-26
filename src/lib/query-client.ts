import { environmentManager, QueryClient } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    // With SSR, a staleTime above 0 stops the client refetching immediately.
    defaultOptions: { queries: { staleTime: 5000 } },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * One client per server request, so no user's cache leaks into another's, and
 * one browser singleton, so a render that suspends does not throw the cache away.
 */
export function getQueryClient() {
  if (environmentManager.isServer()) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
