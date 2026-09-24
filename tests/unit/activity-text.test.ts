import { describe, expect, it } from 'vitest';
import { describeActivity } from '@/lib/activity-text';
import type { FeedEntry } from '@/server/activity/queries';

type ActivityEntry = Extract<FeedEntry, { type: 'activity' }>;

function activity(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    type: 'activity',
    id: 'activity_1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    actorId: 'user_1',
    actorName: 'Ada',
    kind: 'assignee',
    from: null,
    to: null,
    ...overrides,
  };
}

describe('describeActivity', () => {
  it('describes assigning a task to someone', () => {
    expect(describeActivity(activity({ kind: 'assignee', from: null, to: 'Grace' })))
      .toBe('assigned it to Grace');
  });

  it('names the previous assignee when unassigning with a resolved name', () => {
    expect(describeActivity(activity({ kind: 'assignee', from: 'Grace', to: null })))
      .toBe('unassigned Grace');
  });

  it('never renders the literal word "null" when the previous assignee has no name', () => {
    const text = describeActivity(activity({ kind: 'assignee', from: null, to: null }));
    expect(text).toBe('unassigned it');
    expect(text).not.toContain('null');
  });
});
