import { afterEach, describe, expect, it } from 'vitest';
import { cronAuthorized } from '@/lib/cron';

const req = (auth?: string) =>
  new Request('http://localhost/api/cron/x', auth ? { headers: { authorization: auth } } : {});

afterEach(() => { delete process.env.CRON_SECRET; });

describe('cronAuthorized', () => {
  it('accepts the configured bearer secret', () => {
    process.env.CRON_SECRET = 's3cret';
    expect(cronAuthorized(req('Bearer s3cret'))).toBe(true);
  });

  it('rejects a wrong or missing header', () => {
    process.env.CRON_SECRET = 's3cret';
    expect(cronAuthorized(req('Bearer nope'))).toBe(false);
    expect(cronAuthorized(req())).toBe(false);
  });

  it('rejects everyone when no secret is configured', () => {
    expect(cronAuthorized(req('Bearer '))).toBe(false);
    expect(cronAuthorized(req('Bearer undefined'))).toBe(false);
  });
});
