'use client';

import {
  IconAlertCircleFilled, IconCircleCheckFilled, IconDownload, IconLoader2, IconTrash, IconX,
} from '@tabler/icons-react';
import * as CompactButton from '@/components/ui/compact-button';
import * as FileFormatIcon from '@/components/ui/file-format-icon';
import * as ProgressBar from '@/components/ui/progress-bar';
import { fileFormat, formatBytes, isInlineType } from '@/lib/attachments';
import type { UploadItem } from '@/lib/upload-queue';
import { cn } from '@/utils/cn';

function FileGlyph({ fileName, contentType, thumbnail }: { fileName: string; contentType: string; thumbnail?: string }) {
  if (thumbnail && isInlineType(contentType) && contentType.startsWith('image/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served through the /api/attachments redirect route, not optimisable
      <img src={thumbnail} alt="" className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-inset ring-stroke-soft-200" />
    );
  }
  const { label, color } = fileFormat(fileName, contentType);
  return <FileFormatIcon.Root format={label} color={color} />;
}

/** A saved attachment (File Upload 01, "completed"). */
export function ReadyAttachmentCard({
  id, fileName, contentType, size, meta, canDelete, onDelete,
}: {
  id: string; fileName: string; contentType: string; size: number; meta: string;
  canDelete: boolean; onDelete: () => void;
}) {
  const href = `/api/attachments/${id}`;
  return (
    <li className="group relative flex items-center gap-3 rounded-2xl bg-bg-white-0 p-4 ring-1 ring-inset ring-stroke-soft-200 transition-colors duration-150 hover:bg-bg-weak-50">
      <FileGlyph fileName={fileName} contentType={contentType} thumbnail={href} />
      <div className="min-w-0 flex-1">
        {/* The stretched link makes the whole card open the file. */}
        <a href={href} target="_blank" rel="noopener" className="block truncate text-label-sm text-text-strong-950 after:absolute after:inset-0">
          {fileName}
        </a>
        <p className="truncate text-paragraph-xs text-text-sub-600">{formatBytes(size)} · {meta}</p>
      </div>
      <div className="relative flex shrink-0 items-center gap-1">
        <CompactButton.Root variant="ghost" size="large" asChild>
          <a href={`${href}?download=1`} aria-label={`Download ${fileName}`}>
            <CompactButton.Icon as={IconDownload} aria-hidden="true" />
          </a>
        </CompactButton.Root>
        {canDelete && (
          <CompactButton.Root variant="ghost" size="large" onClick={onDelete} aria-label={`Delete ${fileName}`}>
            <CompactButton.Icon as={IconTrash} aria-hidden="true" />
          </CompactButton.Root>
        )}
      </div>
    </li>
  );
}

/** An upload in this session (File Upload 01, uploading / completed / failed). */
export function UploadCard({
  item, onCancel, onRetry, onRemove,
}: {
  item: UploadItem; onCancel: () => void; onRetry: () => void; onRemove: () => void;
}) {
  const { file, state } = item;
  const failed = state === 'failed';
  return (
    <li className={cn(
      'flex flex-col gap-3 rounded-2xl bg-bg-white-0 p-4 ring-1 ring-inset',
      failed ? 'ring-error-base' : 'ring-stroke-soft-200',
    )}>
      <div className="flex items-start gap-3">
        <FileGlyph fileName={file.name} contentType={file.type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-sm text-text-strong-950">{file.name}</p>
          <p aria-live="polite" className="flex items-center gap-1 text-paragraph-xs text-text-sub-600">
            <span className="tabular">
              {state === 'uploading' ? `${formatBytes(item.loaded)} of ${formatBytes(file.size)}` : formatBytes(file.size)}
            </span>
            <span aria-hidden="true">·</span>
            {state === 'queued' && <span>Queued</span>}
            {state === 'uploading' && (
              <><IconLoader2 className="size-4 animate-spin text-information-base" aria-hidden="true" /> Uploading…</>
            )}
            {state === 'done' && (
              <><IconCircleCheckFilled className="size-4 text-success-base" aria-hidden="true" /> Completed</>
            )}
            {failed && (
              <><IconAlertCircleFilled className="size-4 text-error-base" aria-hidden="true" /> {item.error ?? 'Upload failed.'}</>
            )}
          </p>
          {failed && item.retryable && (
            <button type="button" onClick={onRetry} className="mt-2 text-label-sm text-error-base underline underline-offset-2">
              Try Again
            </button>
          )}
        </div>
        {state === 'done' ? (
          <CompactButton.Root variant="ghost" size="large" onClick={onRemove} aria-label={`Delete ${file.name}`}>
            <CompactButton.Icon as={IconTrash} aria-hidden="true" />
          </CompactButton.Root>
        ) : failed ? (
          <CompactButton.Root variant="ghost" size="large" onClick={onCancel} aria-label={`Dismiss ${file.name}`}>
            <CompactButton.Icon as={IconTrash} className="text-error-base" aria-hidden="true" />
          </CompactButton.Root>
        ) : item.confirming ? null : (
          <CompactButton.Root variant="ghost" size="large" onClick={onCancel} aria-label={`Cancel ${file.name}`}>
            <CompactButton.Icon as={IconX} aria-hidden="true" />
          </CompactButton.Root>
        )}
      </div>
      {state === 'uploading' && (
        <ProgressBar.Root value={item.loaded} max={file.size} aria-label={`Uploading ${file.name}`} />
      )}
    </li>
  );
}
