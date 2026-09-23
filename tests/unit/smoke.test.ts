import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';

describe('test harness', () => {
  it('runs with the clock pinned to UTC', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });

  it('can reach the test database', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const { rows } = await pool.query<{ ok: number }>('select 1 as ok');
      expect(rows[0].ok).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
