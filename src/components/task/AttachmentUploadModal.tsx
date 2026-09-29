'use client';

import { IconCloudUpload } from '@tabler/icons-react';
import { useEffect, useId } from 'react';
import { UploadCard } from '@/components/task/AttachmentCard';
import { setUploadModalOpen, type useAttachmentUploads } from '@/components/task/use-attachment-uploads';
import * as FileUpload from '@/components/ui/file-upload';
import * as Modal from '@/components/ui/modal';

type Uploads = ReturnType<typeof useAttachmentUploads>;

/** AlignUI Pro "File Upload 03": header, dashed dropzone, per-file cards. */
export function AttachmentUploadModal({
  taskId, open, onOpenChange, uploads,
}: {
  taskId: string; open: boolean; onOpenChange: (open: boolean) => void; uploads: Uploads;
}) {
  const inputId = useId();

  useEffect(() => {
    setUploadModalOpen(taskId, open);
    return () => setUploadModalOpen(taskId, false);
  }, [open, taskId]);

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content className="max-w-[440px]">
        <Modal.Header
          icon={IconCloudUpload}
          title="Upload files"
          description="Attach files to this task"
        />
        <Modal.Body className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          <FileUpload.Root
            htmlFor={inputId}
            className="has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-base"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              uploads.add(Array.from(e.dataTransfer.files));
            }}
          >
            <input
              id={inputId}
              type="file"
              multiple
              className="sr-only"
              aria-label="Choose files to attach"
              onChange={(e) => {
                uploads.add(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <FileUpload.Icon as={IconCloudUpload} />
            <div className="space-y-1.5">
              <div className="text-label-sm text-text-strong-950">Choose a file or drag &amp; drop it here</div>
              <div className="text-paragraph-xs text-text-sub-600">Any file type, up to 25 MB.</div>
            </div>
            <FileUpload.Button>Browse File</FileUpload.Button>
          </FileUpload.Root>

          {uploads.items.length > 0 && (
            <ul className="flex flex-col gap-3" aria-label="Uploads">
              {uploads.items.map((item) => (
                <UploadCard
                  key={item.localId}
                  item={item}
                  onCancel={() => uploads.cancel(item.localId)}
                  onRetry={() => uploads.retry(item.localId)}
                  onRemove={() => void uploads.remove(item.localId)}
                />
              ))}
            </ul>
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
