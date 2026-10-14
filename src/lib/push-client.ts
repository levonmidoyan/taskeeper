/** Browser-side push helpers, kept pure so they test without a browser. */

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushEnv = { hasServiceWorker: boolean; hasPushManager: boolean; userAgent: string; standalone: boolean };

/** iOS exposes push only to home-screen apps (16.4+), so a Safari tab there means "install first". */
export function pushSupport(env: PushEnv): 'ok' | 'unsupported' | 'ios-install' {
  const ios = /iPhone|iPad|iPod/.test(env.userAgent);
  if (ios && !env.standalone) return 'ios-install';
  if (!env.hasServiceWorker || !env.hasPushManager) return 'unsupported';
  return 'ok';
}
