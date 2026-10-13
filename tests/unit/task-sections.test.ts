import { describe, expect, it } from 'vitest';
import { parseCollapsedSections, withSectionOpen } from '@/lib/task-sections';

describe('parseCollapsedSections', () => {
  it('treats nothing stored as every section open', () => {
    expect(parseCollapsedSections(null)).toEqual({});
    expect(parseCollapsedSections('')).toEqual({});
  });

  it('keeps known sections marked collapsed', () => {
    expect(parseCollapsedSections('{"activity":true,"subtasks":true}')).toEqual({
      activity: true,
      subtasks: true,
    });
  });

  it('drops unknown keys, non-true values and malformed JSON', () => {
    expect(parseCollapsedSections('{"activity":"yes","other":true,"description":false}')).toEqual({});
    expect(parseCollapsedSections('[1,2]')).toEqual({});
    expect(parseCollapsedSections('{not json')).toEqual({});
  });
});

describe('withSectionOpen', () => {
  it('collapses and reopens one section without touching the others', () => {
    const closed = withSectionOpen({ subtasks: true }, 'activity', false);
    expect(closed).toEqual({ subtasks: true, activity: true });
    expect(withSectionOpen(closed, 'activity', true)).toEqual({ subtasks: true });
  });
});
