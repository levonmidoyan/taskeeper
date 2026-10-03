import { createElement } from 'react';
import { render } from 'react-email';
import { describe, expect, it } from 'vitest';
import { DigestEmail, ReminderEmail } from '@/lib/reminder-email';

describe('ReminderEmail', () => {
  it('names the task, project and when it is due, with a link', async () => {
    const text = await render(
      createElement(ReminderEmail, {
        data: { title: 'Ship v2', projectName: 'Website', dueDate: '2026-10-10', offsetDays: 1, daysLeft: 1 },
        url: 'https://app.test/acme/tasks/t1',
      }),
      { plainText: true },
    );
    // Plain text renders headings upper-case.
    expect(text.toLowerCase()).toContain('ship v2');
    expect(text).toContain('Website');
    expect(text).toContain('due tomorrow');
    expect(text).toContain('https://app.test/acme/tasks/t1');
  });
});

describe('DigestEmail', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, dueDate: '2026-10-10' }));

  it('lists the tasks and says how many more there are', async () => {
    const text = await render(
      createElement(DigestEmail, {
        data: { localDate: '2026-10-10', dueToday: 23, overdue: 2, tasks },
        workspaceName: 'Acme',
        url: 'https://app.test/acme/calendar',
      }),
      { plainText: true },
    );
    expect(text.toLowerCase()).toContain('23 due today · 2 overdue');
    expect(text).toContain('Task 19');
    expect(text).toContain('and 5 more');
    expect(text).toContain('https://app.test/acme/calendar');
  });

  it('has no "more" line when every task is listed', async () => {
    const text = await render(
      createElement(DigestEmail, {
        data: { localDate: '2026-10-10', dueToday: 1, overdue: 0, tasks: tasks.slice(0, 1) },
        workspaceName: 'Acme',
        url: 'https://app.test/acme/calendar',
      }),
      { plainText: true },
    );
    expect(text).not.toContain('more');
  });

  it('renders a task title with markup as text', async () => {
    const html = await render(
      createElement(DigestEmail, {
        data: { localDate: '2026-10-10', dueToday: 1, overdue: 0, tasks: [{ id: 'x', title: '<b>bold</b>', dueDate: '2026-10-10' }] },
        workspaceName: 'Acme',
        url: 'https://app.test/acme/calendar',
      }),
    );
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});
