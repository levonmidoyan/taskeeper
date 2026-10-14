'use client';

import {
  IconChevronLeft, IconChevronRight, IconDownload, IconExternalLink, IconLoader2,
} from '@tabler/icons-react';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import * as CompactButton from '@/components/ui/compact-button';
import * as FileFormatIcon from '@/components/ui/file-format-icon';
import * as Modal from '@/components/ui/modal';
import { fileFormat, formatBytes, previewKind } from '@/lib/attachments';
import { codeLanguage, type CodeLanguage } from '@/lib/code-language';
import type { AttachmentView } from '@/server/attachments/queries';
import { Hint } from '@/components/shell/ShortcutHint';

function Loading() {
  return (
    <div className="flex h-full items-center justify-center text-text-sub-600">
      <IconLoader2 className="size-5 animate-spin" aria-label="Loading preview" />
    </div>
  );
}

// CodeMirror is a sizeable chunk; only a code preview downloads it.
const CodeView = dynamic(() => import('@/components/task/CodeView'), { ssr: false, loading: Loading });

function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex h-full items-center justify-center p-4 text-center text-paragraph-sm text-text-sub-600">
      {children}
    </p>
  );
}

type TextState =
  | { status: 'loading' }
  | { status: 'ok'; text: string; truncated: boolean }
  | { status: 'error' };

/** Plain text in a <pre>, or code in CodeMirror when `language` is given (null = unhighlighted code). */
function TextPreview({ id, code }: { id: string; code?: { language: CodeLanguage | null } }) {
  const [state, setState] = useState<TextState>({ status: 'loading' });

  useEffect(() => {
    // Keyed by attachment id by the parent, so each file mounts fresh in 'loading'.
    const controller = new AbortController();
    fetch(`/api/attachments/${id}/text`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const text = await res.text();
        setState({ status: 'ok', text, truncated: res.headers.get('x-preview-truncated') === '1' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [id]);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <Unavailable>Couldn’t load the preview. Try downloading the file.</Unavailable>;
  return (
    <div className="flex h-full flex-col">
      {state.truncated && (
        <p className="border-b border-stroke-soft-200 bg-bg-weak-50 px-4 py-2 text-paragraph-xs text-text-sub-600">
          Showing the first 256 KB. Download the file to see all of it.
        </p>
      )}
      {code ? (
        <div className="min-h-0 flex-1">
          <CodeView text={state.text} language={code.language} />
        </div>
      ) : (
        <pre
          aria-label="File contents"
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-paragraph-xs text-text-strong-950"
        >
          {state.text}
        </pre>
      )}
    </div>
  );
}

const CANNOT_PLAY = 'This browser can’t play this file. Download it instead.';

/** A video the browser can't decode swaps itself for a note instead of a blank frame. */
function VideoPreview({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Unavailable>{CANNOT_PLAY}</Unavailable>;
  return (
    <div className="flex h-full items-center justify-center bg-black">
      <video src={src} controls preload="metadata" onError={() => setFailed(true)} className="max-h-full max-w-full" />
    </div>
  );
}

function AudioPreview({ src, fileName, contentType }: { src: string; fileName: string; contentType: string }) {
  const [failed, setFailed] = useState(false);
  const { label, color } = fileFormat(fileName, contentType);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-6">
      <FileFormatIcon.Root format={label} color={color} />
      {failed ? (
        <p className="text-paragraph-sm text-text-sub-600">{CANNOT_PLAY}</p>
      ) : (
        <audio src={src} controls preload="metadata" onError={() => setFailed(true)} className="w-full max-w-md" />
      )}
    </div>
  );
}

function PreviewBody({ attachment }: { attachment: AttachmentView }) {
  const href = `/api/attachments/${attachment.id}`;
  const { fileName, contentType } = attachment;
  switch (previewKind(attachment.fileName, attachment.contentType)) {
    case 'image':
      return (
        <div className="flex h-full items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- served through the /api/attachments redirect route, not optimisable */}
          <img src={href} alt={attachment.fileName} className="max-h-full max-w-full object-contain" />
        </div>
      );
    case 'pdf':
      return <iframe src={href} title={attachment.fileName} className="size-full border-0" />;
    case 'video':
      return <VideoPreview src={href} />;
    case 'audio':
      return <AudioPreview src={href} fileName={fileName} contentType={contentType} />;
    case 'text':
      return <TextPreview id={attachment.id} />;
    case 'code':
      return <TextPreview id={attachment.id} code={{ language: codeLanguage(fileName, contentType) }} />;
    default:
      return null;
  }
}

/** Views one attachment at a time; arrows step through the previewable ones. */
export function AttachmentPreviewModal({
  attachments, index, onIndexChange, onClose,
}: {
  /** Previewable attachments only. */
  attachments: AttachmentView[];
  /** Null while closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const current = index === null ? undefined : attachments[index];
  const count = attachments.length;
  const step = (delta: number) => {
    if (index === null || count < 2) return;
    onIndexChange((index + delta + count) % count);
  };

  return (
    <Modal.Root open={current !== undefined} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Content
        showClose
        className="flex h-[85vh] max-w-[960px] flex-col overflow-hidden"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          // Arrows belong to the text, the code editor and the media players while they have focus.
          if (e.target instanceof HTMLElement && e.target.closest('pre, .cm-editor, video, audio')) return;
          e.preventDefault();
          e.stopPropagation();
          step(e.key === 'ArrowLeft' ? -1 : 1);
        }}
      >
        {current && (
          <>
            <Modal.Header className="items-center">
              <div className="min-w-0 flex-1">
                <Modal.Title className="truncate">{current.fileName}</Modal.Title>
                <Modal.Description>
                  {formatBytes(current.size)} · {current.uploaderName}
                  {count > 1 && <> · {index! + 1} of {count}</>}
                </Modal.Description>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {count > 1 && (
                  <>
                    <Hint label="Previous attachment">
                      <CompactButton.Root variant="ghost" size="large" onClick={() => step(-1)} aria-label="Previous attachment">
                        <CompactButton.Icon as={IconChevronLeft} aria-hidden="true" />
                      </CompactButton.Root>
                    </Hint>
                    <Hint label="Next attachment">
                      <CompactButton.Root variant="ghost" size="large" onClick={() => step(1)} aria-label="Next attachment">
                        <CompactButton.Icon as={IconChevronRight} aria-hidden="true" />
                      </CompactButton.Root>
                    </Hint>
                  </>
                )}
                {/* Text and code are served for download only, so a new tab would just save them. */}
                {!['text', 'code'].includes(previewKind(current.fileName, current.contentType) ?? '') && (
                  <Hint label="Open in new tab">
                    <CompactButton.Root variant="ghost" size="large" asChild>
                      <a href={`/api/attachments/${current.id}`} target="_blank" rel="noopener" aria-label={`Open ${current.fileName} in a new tab`}>
                        <CompactButton.Icon as={IconExternalLink} aria-hidden="true" />
                      </a>
                    </CompactButton.Root>
                  </Hint>
                )}
                <Hint label="Download">
                  <CompactButton.Root variant="ghost" size="large" asChild>
                    <a href={`/api/attachments/${current.id}?download=1`} aria-label={`Download ${current.fileName}`}>
                      <CompactButton.Icon as={IconDownload} aria-hidden="true" />
                    </a>
                  </CompactButton.Root>
                </Hint>
              </div>
            </Modal.Header>
            <div className="min-h-0 flex-1 bg-bg-weak-50">
              <PreviewBody key={current.id} attachment={current} />
            </div>
          </>
        )}
      </Modal.Content>
    </Modal.Root>
  );
}
