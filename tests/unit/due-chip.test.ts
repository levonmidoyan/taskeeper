import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DueChip } from '@/components/task/DueChip';

const past = '2000-01-01';

describe('DueChip', () => {
  it('flags an open task past its due date as overdue', () => {
    const html = renderToStaticMarkup(createElement(DueChip, { dueDate: past, timezone: 'UTC' }));
    expect(html).toContain('Overdue');
  });

  // Finishing a task late is not a reason to keep it red.
  it('does not flag a done task as overdue', () => {
    const html = renderToStaticMarkup(createElement(DueChip, { dueDate: past, timezone: 'UTC', done: true }));
    expect(html).not.toContain('Overdue');
  });

  it('keeps "Due" and the date on one line', () => {
    const html = renderToStaticMarkup(createElement(DueChip, { dueDate: past, timezone: 'UTC' }));
    expect(html).toContain('whitespace-nowrap');
  });
});
