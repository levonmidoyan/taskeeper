import { afterEach, describe, expect, it } from 'vitest';
import { smtpConfig, smtpErrorCode } from '@/lib/smtp';

afterEach(() => {
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']) delete process.env[key];
});

describe('smtpConfig', () => {
  it('is off without a host, so emails are logged', () => {
    expect(smtpConfig()).toBeNull();
  });

  it('uses TLS on 465 and STARTTLS on the default 587', () => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    expect(smtpConfig()).toMatchObject({ port: 587, secure: false, user: undefined });
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'me@gmail.com';
    process.env.SMTP_PASS = 'app-password';
    expect(smtpConfig()).toEqual({
      host: 'smtp.gmail.com', port: 465, secure: true, user: 'me@gmail.com', pass: 'app-password',
    });
  });
});

describe('smtpErrorCode', () => {
  it('marks temporary SMTP replies as a rate limit to wait out', () => {
    for (const responseCode of [421, 450, 451, 452]) {
      expect(smtpErrorCode({ responseCode })).toBe('rate_limit_exceeded');
    }
  });

  it('keeps permanent replies and connection errors distinct', () => {
    expect(smtpErrorCode({ responseCode: 550, code: 'EENVELOPE' })).toBe('smtp_550');
    expect(smtpErrorCode({ code: 'EAUTH' })).toBe('EAUTH');
    expect(smtpErrorCode(new Error('boom'))).toBe('unknown');
    expect(smtpErrorCode(null)).toBe('unknown');
  });
});
