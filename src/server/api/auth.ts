import { authenticateApiToken } from '@/server/api-tokens/service';

export type ApiPrincipal = { userId: string; tokenId: string };

type Strategy = (request: Request) => Promise<ApiPrincipal | null>;

/** Authorization: Bearer tk_… */
const personalToken: Strategy = async (request) => {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '');
  return match ? authenticateApiToken(match[1]) : null;
};

/**
 * Tried in order; the first that recognises the request wins. Mobile (14b)
 * adds a Better Auth bearer-session strategy here and nothing else changes.
 */
const STRATEGIES: Strategy[] = [personalToken];

export async function authenticateRequest(request: Request): Promise<ApiPrincipal | null> {
  for (const strategy of STRATEGIES) {
    const principal = await strategy(request);
    if (principal) return principal;
  }
  return null;
}
