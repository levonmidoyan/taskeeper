import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES, attachmentKey, contentDisposition, fileFormat, formatBytes,
  isInlineType, normalizeContentType, sanitizeFileName,
} from '@/lib/attachments';

describe('sanitizeFileName', () => {
  // Review Focus 2.
  it('keeps only the last path segment', () => {
    expect(sanitizeFileName('C:\\Users\\ada\\report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
  });
  it('strips control characters and trims', () => {
    expect(sanitizeFileName('  a\u0000b\nc.txt  ')).toBe('abc.txt');
  });
  it('caps at 255 code points without splitting an emoji', () => {
    const out = sanitizeFileName('😀'.repeat(300));
    expect(Array.from(out)).toHaveLength(255);
    expect(out.endsWith('😀')).toBe(true);
  });
  it('falls back to "file"', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('/')).toBe('file');
  });
});

describe('normalizeContentType', () => {
  it('lowercases and drops parameters', () => {
    expect(normalizeContentType('Text/Plain; charset=UTF-8')).toBe('text/plain');
  });
  it('falls back to octet-stream for junk', () => {
    expect(normalizeContentType('')).toBe('application/octet-stream');
    expect(normalizeContentType('not a type')).toBe('application/octet-stream');
    expect(normalizeContentType(`a/${'b'.repeat(300)}`)).toBe('application/octet-stream');
  });
});

describe('isInlineType', () => {
  // Review Focus 3.
  it('allows safe images and pdf only', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf']) {
      expect(isInlineType(t), t).toBe(true);
    }
    for (const t of ['image/svg+xml', 'text/html', 'text/plain', 'application/octet-stream', 'application/xhtml+xml']) {
      expect(isInlineType(t), t).toBe(false);
    }
  });
});

describe('contentDisposition', () => {
  it('encodes UTF-8 names with an ASCII fallback', () => {
    expect(contentDisposition('résumé "v2".pdf', false))
      .toBe(`attachment; filename="r_sum_ _v2_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`);
  });
  it('uses inline when asked', () => {
    expect(contentDisposition('a.png', true)).toBe(`inline; filename="a.png"; filename*=UTF-8''a.png`);
  });
  it('encodes characters encodeURIComponent leaves alone', () => {
    expect(contentDisposition("it's (1)*.txt", false))
      .toBe(`attachment; filename="it_s (1)*.txt"; filename*=UTF-8''it%27s%20%281%29%2A.txt`);
  });
});

describe('attachmentKey', () => {
  it('never contains the file name', () => {
    expect(attachmentKey('w1', 't1', 'a1')).toBe('ws/w1/tasks/t1/a1');
  });
});

describe('formatBytes', () => {
  it('formats B, KB and MB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(120 * 1024)).toBe('120 KB');
    expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe('25.0 MB');
  });
});

describe('fileFormat', () => {
  it('labels by extension and colours by kind', () => {
    expect(fileFormat('cv.pdf', 'application/pdf')).toEqual({ label: 'PDF', color: 'red' });
    expect(fileFormat('shot.PNG', 'image/png')).toEqual({ label: 'PNG', color: 'blue' });
    expect(fileFormat('notes.docx', 'application/octet-stream')).toEqual({ label: 'DOCX', color: 'sky' });
    expect(fileFormat('data.csv', 'text/csv')).toEqual({ label: 'CSV', color: 'green' });
    expect(fileFormat('bundle.zip', 'application/zip')).toEqual({ label: 'ZIP', color: 'orange' });
    expect(fileFormat('Makefile', 'application/octet-stream')).toEqual({ label: 'FILE', color: 'gray' });
    expect(fileFormat('archive.verylongext', 'application/octet-stream')).toEqual({ label: 'FILE', color: 'gray' });
  });
  it('badges PDFs by content type when extension is missing', () => {
    expect(fileFormat('export', 'application/pdf')).toEqual({ label: 'PDF', color: 'red' });
  });
});
