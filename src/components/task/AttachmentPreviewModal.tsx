'use client';

import {
  IconChevronLeft, IconChevronRight, IconDownload, IconExternalLink, IconLoader2,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import * as CompactButton from '@/components/ui/compact-button';
import * as Modal from '@/components/ui/modal';
import { formatBytes, previewKind } from '@/lib/attachments';
import type { AttachmentView } from '@/server/attachments/queries';

type TextState =
  | { status: 'loading' }
  | { status: 'ok'; text: string; truncated: boolean }
  | { status: 'error' };

function TextPreview({ id }: { id: string }) {
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

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-text-sub-600">
        <IconLoader2 className="size-5 animate-spin" aria-label="Loading preview" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <p className="flex h-full items-center justify-center text-paragraph-sm text-text-sub-600">
        Couldn’t load the preview. Try downloading the file.
      </p>
    );
  }
  return (
    <div className="flex h-full flex-col">
      {state.truncated && (
        <p className="border-b border-stroke-soft-200 bg-bg-weak-50 px-4 py-2 text-paragraph-xs text-text-sub-600">
          Showing the first 256 KB. Download the file to see all of it.
        </p>
      )}
      <pre
        aria-label="File contents"
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-paragraph-xs text-text-strong-950"
      >
        {state.text}
      </pre>
    </div>
  );
}

function PreviewBody({ attachment }: { attachment: AttachmentView }) {
  const href = `/api/attachments/${attachment.id}`;
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
    case 'text':
      return <TextPreview id={attachment.id} />;
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
          // Leave arrows alone while text is being selected or scrolled by keyboard.
          if (e.target instanceof HTMLElement && e.target.closest('pre')) return;
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
                    <CompactButton.Root variant="ghost" size="large" onClick={() => step(-1)} aria-label="Previous attachment">
                      <CompactButton.Icon as={IconChevronLeft} aria-hidden="true" />
                    </CompactButton.Root>
                    <CompactButton.Root variant="ghost" size="large" onClick={() => step(1)} aria-label="Next attachment">
                      <CompactButton.Icon as={IconChevronRight} aria-hidden="true" />
                    </CompactButton.Root>
                  </>
                )}
                {/* Text is served for download only, so a new tab would just save it. */}
                {previewKind(current.fileName, current.contentType) !== 'text' && (
                  <CompactButton.Root variant="ghost" size="large" asChild>
                    <a href={`/api/attachments/${current.id}`} target="_blank" rel="noopener" aria-label={`Open ${current.fileName} in a new tab`}>
                      <CompactButton.Icon as={IconExternalLink} aria-hidden="true" />
                    </a>
                  </CompactButton.Root>
                )}
                <CompactButton.Root variant="ghost" size="large" asChild>
                  <a href={`/api/attachments/${current.id}?download=1`} aria-label={`Download ${current.fileName}`}>
                    <CompactButton.Icon as={IconDownload} aria-hidden="true" />
                  </a>
                </CompactButton.Root>
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
