/**
 * Attachment rules shared by the browser and the server. Plain functions with
 * no imports, so the client can check a file before asking for an upload URL
 * and the server applies the very same rules.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Last path segment, control characters removed, at most 255 code points. */
export function sanitizeFileName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? '';
  const cleaned = last.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const capped = Array.from(cleaned).slice(0, 255).join('');
  return capped || 'file';
}

const TOKEN = "[a-z0-9][a-z0-9!#$&^_.+-]*";
const MIME = new RegExp(`^${TOKEN}/${TOKEN}$`);

/** The browser's type without parameters, or octet-stream when it is not a type. */
export function normalizeContentType(type: string): string {
  const essence = type.split(';')[0].trim().toLowerCase();
  return essence.length <= 255 && MIME.test(essence) ? essence : 'application/octet-stream';
}

const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
const AUDIO_TYPES = [
  'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/flac',
];

const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf',
  ...VIDEO_TYPES, ...AUDIO_TYPES,
]);

/**
 * Only types a browser shows without running script. SVG and HTML are
 * deliberately absent: opened inline they would run on the bucket's origin.
 */
export function isInlineType(contentType: string): boolean {
  return INLINE_TYPES.has(contentType);
}

/** Text shown as plain prose: no highlighting helps it. */
const PLAIN_EXTENSIONS = new Set(['txt', 'log', 'csv', 'tsv']);

/** Source shown in the code view. */
export const CODE_EXTENSIONS = new Set([
  'md', 'markdown', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'env',
  'html', 'htm', 'css', 'scss', 'svg', 'sql', 'sh', 'bash',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'h', 'cpp', 'hpp', 'cs',
]);

const CODE_TYPES = new Set([
  'application/json', 'application/xml', 'application/javascript', 'application/x-javascript',
  'application/yaml', 'application/x-yaml', 'application/toml', 'application/sql',
  'application/x-sh', 'application/x-httpd-php', 'image/svg+xml',
  'text/html', 'text/css', 'text/javascript', 'text/markdown', 'text/xml', 'text/x-python',
]);

export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'code';

/** Lowercased extension without the dot, or '' when there is none. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/**
 * How the preview modal shows a file, or null when it cannot. Text and code
 * are always shown as characters, never rendered, so SVG and HTML are safe.
 * A known source extension wins over the type: browsers label .ts as video.
 */
export function previewKind(fileName: string, contentType: string): PreviewKind | null {
  const ext = fileExtension(fileName);
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (PLAIN_EXTENSIONS.has(ext)) return 'text';
  if (contentType === 'application/pdf') return 'pdf';
  if (VIDEO_TYPES.includes(contentType)) return 'video';
  if (AUDIO_TYPES.includes(contentType)) return 'audio';
  if (contentType.startsWith('image/') && isInlineType(contentType)) return 'image';
  if (CODE_TYPES.has(contentType)) return 'code';
  if (contentType.startsWith('text/')) return 'text';
  return null;
}

/** RFC 6266: an ASCII fallback for old clients plus the exact UTF-8 name. */
export function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\']/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function attachmentKey(workspaceId: string, taskId: string, attachmentId: string): string {
  return `ws/${workspaceId}/tasks/${taskId}/${attachmentId}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FormatColor = 'red' | 'blue' | 'sky' | 'green' | 'orange' | 'gray';

const EXT_COLOR: Record<string, FormatColor> = {
  pdf: 'red',
  doc: 'sky', docx: 'sky', txt: 'sky', md: 'sky', rtf: 'sky', odt: 'sky',
  xls: 'green', xlsx: 'green', csv: 'green', ods: 'green',
  zip: 'orange', rar: 'orange', '7z': 'orange', gz: 'orange', tar: 'orange',
};

/** The badge on a file icon: its extension (max 4 chars) and a colour by kind. */
export function fileFormat(fileName: string, contentType: string): { label: string; color: FormatColor } {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  const label = ext && ext.length <= 4 ? ext.toUpperCase() : 'FILE';

  // Images are always blue
  if (contentType.startsWith('image/')) {
    return { label, color: 'blue' };
  }

  // PDFs are red, with 'PDF' label when no extension
  if (contentType === 'application/pdf') {
    return { label: label === 'FILE' ? 'PDF' : label, color: 'red' };
  }

  // Everything else uses extension color
  const color = EXT_COLOR[ext] ?? 'gray';
  return { label, color };
}
