'use client';

import {
  IconArrowUpRight, IconChevronLeft, IconLink, IconTrash, IconX,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TextField } from '@/components/forms/TextField';
import { ActivityFeed } from '@/components/task/ActivityFeed';
import { AssigneePicker } from '@/components/task/AssigneePicker';
import { AttachmentSection } from '@/components/task/AttachmentSection';
import { DueDateField } from '@/components/task/DueDateField';
import { LabelPicker } from '@/components/task/LabelPicker';
import { PRIORITY_LABEL, PriorityIcon } from '@/components/task/Priority';
import { RichTextField } from '@/components/task/RichTextField';
import { StatusIcon } from '@/components/task/StatusIcon';
import { homeCrumb } from '@/components/shell/crumbs';
import { PageBreadcrumb } from '@/components/shell/PageBreadcrumb';
import { SubtaskSection } from '@/components/task/SubtaskSection';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import * as Label from '@/components/ui/label';
import * as Modal from '@/components/ui/modal';
import * as Select from '@/components/ui/select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatInZone } from '@/lib/dates';
import { settle } from '@/lib/settle';
import type { FeedEntry } from '@/server/activity/queries';
import type { AttachmentView } from '@/server/attachments/queries';
import type { MemberRow } from '@/server/labels/queries';
import type { StatusRow } from '@/server/projects/queries';
import { deleteTaskAction, updateTaskAction } from '@/server/tasks/actions';
import type { LabelRow, Priority, TaskDetail } from '@/server/tasks/queries';

const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high', 'urgent'];

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label.Root htmlFor={id}>{label}</Label.Root>
      {children}
    </div>
  );
}

export type TaskDetailViewProps = {
  task: TaskDetail;
  projectId: string;
  statuses: StatusRow[];
  members: MemberRow[];
  allLabels: LabelRow[];
  workspaceSlug: string;
  feed: FeedEntry[];
  currentUserId: string;
  canModerate: boolean;
  timezone: string;
  /** Null when storage is not configured; the section is then hidden. */
  attachments: AttachmentView[] | null;
};

/**
 * The task's header, fields and content, shared by the modal over a project
 * view and the task's own page. `mode` picks how it navigates: the modal
 * swaps ?task= on the page behind it, the page moves between task URLs.
 */
export function TaskDetailView({
  mode,
  projectName,
  task,
  projectId,
  statuses,
  members,
  allLabels,
  workspaceSlug,
  feed,
  currentUserId,
  canModerate,
  timezone,
  attachments,
}: TaskDetailViewProps & { mode: 'modal' | 'page'; projectName?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const confirm = useConfirm();
  const [title, setTitle] = useState(task.title);
  // Field values are held here so a save the server rejects can put the old
  // value back; router.refresh() alone would not, as the server's is unchanged.
  const [assigneeId, setAssigneeId] = useState(task.assigneeId);
  const [statusId, setStatusId] = useState(task.statusId);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate);

  const tasksBase = `/${workspaceSlug}/tasks`;
  const projectHref = `/${workspaceSlug}/projects/${projectId}`;
  const pageHref = `${tasksBase}/${task.id}`;

  function openParent() {
    const next = new URLSearchParams(searchParams);
    next.set('task', task.parentId!);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  function close() {
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    const query = next.toString();
    router.push(query ? `?${query}` : '?', { scroll: false });
  }

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}${pageHref}`).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy the link.'),
    );
  }

  function patch(input: Parameters<typeof updateTaskAction>[1], revert?: () => void) {
    startTransition(async () => {
      const result = await settle(updateTaskAction(workspaceSlug, input));
      if (!result.ok) {
        toast.error(result.error);
        revert?.();
      }
      router.refresh();
    });
  }

  async function onDelete() {
    const ok = await confirm({
      title: `Delete "${task.title}"?`,
      description: 'This also deletes its subtasks. It can’t be undone.',
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await settle(deleteTaskAction(workspaceSlug, { taskId: task.id }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (mode === 'modal') {
        close();
        router.refresh();
      } else {
        // The page's own URL is gone now; land on what it hung off.
        router.replace(task.parentId ? `${tasksBase}/${task.parentId}` : projectHref);
      }
    });
  }

  const deleteButton = (
    <Button.Root type="button" variant="error" mode="ghost" size="xsmall" onClick={onDelete}>
      <Button.Icon as={IconTrash} />
      Delete
    </Button.Root>
  );

  const header = mode === 'modal' ? (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stroke-soft-200 px-5 py-3">
      {task.parentId ? (
        <button
          type="button"
          onClick={openParent}
          className="-ml-1 inline-flex min-w-0 items-center gap-1 rounded-lg px-1 py-1 text-paragraph-xs text-text-sub-600 transition-colors duration-150 hover:text-text-strong-950"
        >
          <IconChevronLeft className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{task.parentTitle}</span>
        </button>
      ) : (
        <span className="text-paragraph-xs text-text-sub-600">Task</span>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {deleteButton}
        <CompactButton.Root variant="ghost" size="large" onClick={copyLink} aria-label="Copy link">
          <CompactButton.Icon as={IconLink} aria-hidden="true" />
        </CompactButton.Root>
        <CompactButton.Root variant="ghost" size="large" asChild>
          <Link href={pageHref} aria-label="Open full page">
            <CompactButton.Icon as={IconArrowUpRight} aria-hidden="true" />
          </Link>
        </CompactButton.Root>
        <Modal.Close asChild>
          <CompactButton.Root variant="ghost" size="large">
            <CompactButton.Icon as={IconX} aria-hidden="true" />
            <span className="sr-only">Close</span>
          </CompactButton.Root>
        </Modal.Close>
      </div>
    </header>
  ) : (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stroke-soft-200 px-4 py-3 lg:px-6">
      <PageBreadcrumb
        items={[
          homeCrumb(workspaceSlug),
          { label: projectName ?? 'Project', href: projectHref },
          ...(task.parentId ? [{ label: task.parentTitle ?? 'Parent task', href: `${tasksBase}/${task.parentId}` }] : []),
          { label: task.title },
        ]}
      />

      <div className="flex shrink-0 items-center gap-1">
        {deleteButton}
        <CompactButton.Root variant="ghost" size="large" onClick={copyLink} aria-label="Copy link">
          <CompactButton.Icon as={IconLink} aria-hidden="true" />
        </CompactButton.Root>
      </div>
    </header>
  );

  return (
    <>
      {header}

      {/* One scrolling column on small screens (title, fields, content);
          from lg the content and the fields sidebar scroll independently. */}
      <div className="grid min-h-0 flex-1 auto-rows-max overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
        <div className="px-5 pt-5 lg:col-start-1 lg:row-start-1">
          <TextField
            id="task-title"
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            // Save on blur, not per keystroke, so one edit is one write.
            onBlur={() => title.trim() && title !== task.title && patch({ taskId: task.id, title })}
            maxLength={200}
          />
        </div>

        <aside className="flex flex-col gap-4 border-b border-stroke-soft-200 p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:overflow-y-auto lg:border-b-0 lg:border-l">
          <Field id="task-status" label="Status">
            <Select.Root
              value={statusId}
              onValueChange={(next) => {
                const previous = statusId;
                setStatusId(next);
                patch({ taskId: task.id, statusId: next }, () => setStatusId(previous));
              }}
            >
              <Select.Trigger id="task-status"><Select.Value /></Select.Trigger>
              <Select.Content>
                {statuses.map((s) => (
                  <Select.Item key={s.id} value={s.id}>
                    <StatusIcon status={s} />
                    {s.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field>

          <Field id="task-priority" label="Priority">
            <Select.Root
              value={priority}
              onValueChange={(value) => {
                const previous = priority;
                const next = value as Priority;
                setPriority(next);
                patch({ taskId: task.id, priority: next }, () => setPriority(previous));
              }}
            >
              <Select.Trigger id="task-priority"><Select.Value /></Select.Trigger>
              <Select.Content>
                {PRIORITIES.map((p) => (
                  <Select.Item key={p} value={p}>
                    <PriorityIcon priority={p} />
                    {PRIORITY_LABEL[p]}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field>

          <Field id="task-assignee" label="Assignee">
            <AssigneePicker
              id="task-assignee"
              members={members}
              value={assigneeId}
              onChange={(next) => {
                const previous = assigneeId;
                setAssigneeId(next);
                patch({ taskId: task.id, assigneeId: next }, () => setAssigneeId(previous));
              }}
            />
          </Field>

          <DueDateField
            id="task-due"
            value={dueDate}
            timezone={timezone}
            // A bare YYYY-MM-DD string, never a Date: the value is a calendar
            // day in the workspace zone (v1 spec §3.4).
            onChange={(next) => {
              const previous = dueDate;
              setDueDate(next);
              patch({ taskId: task.id, dueDate: next }, () => setDueDate(previous));
            }}
          />

          <div className="flex flex-col gap-1">
            <span className="text-label-sm text-text-strong-950">Labels</span>
            <LabelPicker
              workspaceSlug={workspaceSlug}
              taskId={task.id}
              allLabels={allLabels}
              selected={task.labels}
            />
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-stroke-soft-200 pt-4 text-paragraph-xs">
            <dt className="text-text-sub-600">Created</dt>
            <dd className="tabular text-text-strong-950">
              <time dateTime={task.createdAt.toISOString()}>{formatInZone(task.createdAt, timezone)}</time>
            </dd>
            <dt className="text-text-sub-600">Updated</dt>
            <dd className="tabular text-text-strong-950">
              <time dateTime={task.updatedAt.toISOString()}>{formatInZone(task.updatedAt, timezone)}</time>
            </dd>
          </dl>
        </aside>

        <div className="flex flex-col gap-5 p-5 lg:col-start-1 lg:row-start-2 lg:overflow-y-auto">
          <div className="flex flex-col gap-1">
            <span id="task-description-label" className="text-label-sm text-text-strong-950">
              Description
            </span>
            <RichTextField
              value={task.description}
              labelledBy="task-description-label"
              placeholder="Add details… Type / for headings, lists and more."
              onCommit={(description) => patch({ taskId: task.id, description })}
            />
          </div>

          {/* Depth is capped at one level: a subtask offers the way back to
              its parent instead of a nested list. */}
          {!task.parentId && (
            <SubtaskSection
              parent={task}
              subtasks={task.subtasks}
              statuses={statuses}
              projectId={projectId}
              workspaceSlug={workspaceSlug}
              pageBase={mode === 'page' ? tasksBase : undefined}
            />
          )}

          {attachments && (
            <AttachmentSection
              taskId={task.id}
              attachments={attachments}
              workspaceSlug={workspaceSlug}
              currentUserId={currentUserId}
              canModerate={canModerate}
              timezone={timezone}
            />
          )}

          <ActivityFeed
            taskId={task.id}
            feed={feed}
            workspaceSlug={workspaceSlug}
            currentUserId={currentUserId}
            canModerate={canModerate}
            timezone={timezone}
          />
        </div>
      </div>
    </>
  );
}
