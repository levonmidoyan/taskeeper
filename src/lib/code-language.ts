import { fileExtension } from '@/lib/attachments';

/** Grammars the code preview can highlight; each is loaded only when needed. */
export type CodeLanguage =
  | 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'json' | 'python' | 'html' | 'xml' | 'css'
  | 'sql' | 'markdown' | 'yaml' | 'php' | 'java' | 'go' | 'rust' | 'cpp';

const BY_EXTENSION: Record<string, CodeLanguage> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', tsx: 'tsx', json: 'json', py: 'python',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'css', sql: 'sql', md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml', php: 'php', java: 'java', go: 'go', rs: 'rust',
  c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp',
};

const BY_TYPE: Record<string, CodeLanguage> = {
  'application/json': 'json', 'application/xml': 'xml', 'text/xml': 'xml', 'image/svg+xml': 'xml',
  'application/javascript': 'javascript', 'application/x-javascript': 'javascript', 'text/javascript': 'javascript',
  'application/yaml': 'yaml', 'application/x-yaml': 'yaml', 'application/sql': 'sql',
  'application/x-httpd-php': 'php', 'text/html': 'html', 'text/css': 'css',
  'text/markdown': 'markdown', 'text/x-python': 'python',
};

/** The grammar for a code attachment, or null to show it unhighlighted. */
export function codeLanguage(fileName: string, contentType: string): CodeLanguage | null {
  return BY_EXTENSION[fileExtension(fileName)] ?? BY_TYPE[contentType] ?? null;
}
