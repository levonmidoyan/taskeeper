import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TABLE_SETTINGS,
  TABLE_COLUMNS,
  parseTableSettings,
  tableSettingsKey,
} from '@/lib/task-table-settings';

describe('parseTableSettings', () => {
  it('falls back to the defaults for nothing stored or malformed JSON', () => {
    expect(parseTableSettings(null)).toEqual(DEFAULT_TABLE_SETTINGS);
    expect(parseTableSettings('')).toEqual(DEFAULT_TABLE_SETTINGS);
    expect(parseTableSettings('{nope')).toEqual(DEFAULT_TABLE_SETTINGS);
    expect(parseTableSettings('42')).toEqual(DEFAULT_TABLE_SETTINGS);
    expect(parseTableSettings('null')).toEqual(DEFAULT_TABLE_SETTINGS);
  });

  it('defaults to every column, in table order, comfortable, 50 a page', () => {
    expect(DEFAULT_TABLE_SETTINGS).toEqual({
      columnOrder: [...TABLE_COLUMNS],
      hidden: [],
      density: 'comfortable',
      pageSize: 50,
    });
  });

  it('keeps valid stored settings', () => {
    const stored = {
      columnOrder: ['title', 'due', 'status', 'priority', 'assignee', 'created', 'updated', 'labels'],
      hidden: ['created', 'labels'],
      density: 'compact',
      pageSize: 100,
    };
    expect(parseTableSettings(JSON.stringify(stored))).toEqual(stored);
  });

  it('drops unknown and duplicate columns and appends ones added since', () => {
    const parsed = parseTableSettings(
      JSON.stringify({ columnOrder: ['due', 'bogus', 'status', 'due'], hidden: ['bogus', 'labels', 'labels'] }),
    );
    expect(parsed.columnOrder).toEqual([
      'title', 'due', 'status', 'priority', 'assignee', 'created', 'updated', 'labels',
    ]);
    expect(parsed.hidden).toEqual(['labels']);
  });

  it('keeps Title first and never hidden', () => {
    const parsed = parseTableSettings(
      JSON.stringify({ columnOrder: ['status', 'title', 'due'], hidden: ['title', 'due'] }),
    );
    expect(parsed.columnOrder[0]).toBe('title');
    expect(parsed.columnOrder.filter((c) => c === 'title')).toHaveLength(1);
    expect(parsed.hidden).toEqual(['due']);
  });

  it('replaces an unknown density or page size with the default', () => {
    const parsed = parseTableSettings(JSON.stringify({ density: 'tiny', pageSize: 37 }));
    expect(parsed.density).toBe('comfortable');
    expect(parsed.pageSize).toBe(50);
    expect(parseTableSettings(JSON.stringify({ pageSize: '25' })).pageSize).toBe(50);
    expect(parseTableSettings(JSON.stringify({ pageSize: 25 })).pageSize).toBe(25);
  });
});

describe('tableSettingsKey', () => {
  it('scopes the stored settings to one project', () => {
    expect(tableSettingsKey('p1')).not.toBe(tableSettingsKey('p2'));
    expect(tableSettingsKey('p1')).toContain('p1');
  });
});
