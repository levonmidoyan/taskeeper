'use client';

import { IconPaperclip } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ReadyAttachmentCard, UploadCard } from '@/components/task/AttachmentCard';
import { AttachmentUploadModal } from '@/components/task/AttachmentUploadModal';
import { useAttachmentUploads } from '@/components/task/use-attachment-uploads';
import * as Button from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatInZone } from '@/lib/dates';
import type { AttachmentView } from '@/server/attachments/queries';
import { deleteAttachmentAction } from '@/server/attachments/actions';
import { cn } from '@/utils/cn';

export function AttachmentSection({
  taskId, attachments, workspaceSlug, currentUserId, canModerate, timezone,
}: {
  taskId: string;
  attachments: AttachmentView[];
  workspaceSlug: string;
  currentUserId: string;
  canModerate: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const uploads = useAttachmentUploads(workspaceSlug, taskId);
  const [modalOpen, setModalOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Completed uploads appear in `attachments` after the refresh, so the
  // section only shows the ones still in flight or failed.
  const active = uploads.items.filter((i) => i.state !== 'done');

  async function onDelete(a: AttachmentView) {
    const ok = await confirm({ title: `Delete "${a.fileName}"?`, description: 'It can’t be undone.' });
    if (!ok) return;
    try {
      const result = await deleteAttachmentAction(workspaceSlug, { attachmentId: a.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
      return;
    }
    router.refresh();
  }

  return (
    <section
      aria-labelledby={`attachments-${taskId}`}
      className={cn('flex flex-col gap-2 rounded-2xl transition-shadow', dragging && 'ring-2 ring-primary-base ring-offset-4 ring-offset-bg-white-0')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        uploads.add(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex items-center justify-between">
        <h2 id={`attachments-${taskId}`} className="text-label-sm text-text-strong-950">
          Attachments
          {attachments.length > 0 && (
            <span className="tabular ml-1.5 text-paragraph-xs text-text-sub-600">{attachments.length}</span>
          )}
        </h2>
        <Button.Root type="button" variant="neutral" mode="stroke" size="xsmall" onClick={() => setModalOpen(true)}>
          <Button.Icon as={IconPaperclip} />
          Attach files
        </Button.Root>
      </div>

      {attachments.length === 0 && active.length === 0 ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-xl border border-dashed border-stroke-sub-300 px-4 py-5 text-center text-paragraph-xs text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50"
        >
          <span className="text-label-sm text-text-strong-950">Drop files here or browse</span>
          <br />
          Any file type, up to 25 MB.
        </button>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Attachments">
          {active.map((item) => (
            <UploadCard
              key={item.localId}
              item={item}
              onCancel={() => uploads.cancel(item.localId)}
              onRetry={() => uploads.retry(item.localId)}
              onRemove={() => void uploads.remove(item.localId)}
            />
          ))}
          {attachments.map((a) => (
            <ReadyAttachmentCard
              key={a.id}
              id={a.id}
              fileName={a.fileName}
              contentType={a.contentType}
              size={a.size}
              meta={`${a.uploaderName} · ${formatInZone(a.createdAt, timezone)}`}
              canDelete={a.uploaderId === currentUserId || canModerate}
              onDelete={() => void onDelete(a)}
            />
          ))}
        </ul>
      )}

      <AttachmentUploadModal taskId={taskId} open={modalOpen} onOpenChange={setModalOpen} uploads={uploads} />
    </section>
  );
}
