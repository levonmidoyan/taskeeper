import { describe, expect, it } from 'vitest';
import {
  escapeMentionLabel, extractMentionIds, filterMembers, mentionMarkdown, mentionsToText, unescapeMentionLabel,
} from '@/lib/mentions';

describe('mentionMarkdown', () => {
  it('builds the stored link', () => {
    expect(mentionMarkdown('usr_1', 'Ana Petrosyan')).toBe('[@Ana Petrosyan](mention:usr_1)');
  });
  it('escapes brackets and backslashes in the label, reversibly', () => {
    expect(escapeMentionLabel('Odd ] [na\\me')).toBe('Odd \\] \\[na\\\\me');
    expect(unescapeMentionLabel(escapeMentionLabel('Odd ] [na\\me'))).toBe('Odd ] [na\\me');
  });
});

describe('extractMentionIds', () => {
  it('finds ids in order of first occurrence, deduped', () => {
    expect(extractMentionIds('[@A](mention:a) hi [@B](mention:b) [@A](mention:a)')).toEqual(['a', 'b']);
  });
  it('ignores code spans and fenced blocks', () => {
    expect(extractMentionIds('`[@A](mention:a)`')).toEqual([]);
    expect(extractMentionIds('```\n[@A](mention:a)\n```\n[@B](mention:b)')).toEqual(['b']);
  });
  it('ignores malformed links and other schemes', () => {
    expect(extractMentionIds('[@A](mention:) [@B](mention:b c) [A](mention:x) [@C](https://c.com)')).toEqual([]);
  });
  it('handles an escaped bracket in the label', () => {
    expect(extractMentionIds('[@Odd \\] name](mention:x1)')).toEqual(['x1']);
  });
});

describe('mentionsToText', () => {
  it('turns links into @Name', () => {
    expect(mentionsToText('ping [@Ana](mention:a) and [@Odd \\] x](mention:b)')).toBe('ping @Ana and @Odd ] x');
  });
});

describe('filterMembers', () => {
  const members = [
    { name: 'Ana Petrosyan', email: 'ana@x.com' },
    { name: 'Bob', email: 'robert@x.com' },
    { name: 'Cleo', email: 'cleo@x.com' },
  ];
  it('matches name or email, case-insensitive', () => {
    expect(filterMembers(members, 'PET').map((m) => m.name)).toEqual(['Ana Petrosyan']);
    expect(filterMembers(members, 'robert').map((m) => m.name)).toEqual(['Bob']);
  });
  it('returns everyone (capped) for an empty query', () => {
    expect(filterMembers(members, '', 2)).toHaveLength(2);
  });
});
