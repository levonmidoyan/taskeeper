'use client';

import {
  IconArrowUpRight, IconChevronLeft, IconDots, IconLink, IconTrash, IconX,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TextField } from '@/components/forms/TextField';
import { ActivityFeed } from '@/components/task/ActivityFeed';
import { AssigneePicker } from '@/components/task/AssigneePicker';
import { AttachmentPreviewModal } from '@/components/task/AttachmentPreviewModal';
import { AttachmentSection } from '@/components/task/AttachmentSection';
import { DescriptionField } from '@/components/task/DescriptionField';
import { DueDateField } from '@/components/task/DueDateField';
import { ReminderField } from '@/components/task/ReminderField';
import { LabelPicker } from '@/components/task/LabelPicker';
import { PRIORITY_LABEL, PriorityIcon } from '@/components/task/Priority';
import { StatusIcon } from '@/components/task/StatusIcon';
import { homeCrumb } from '@/components/shell/crumbs';
import { ShortcutTooltip } from '@/components/shell/ShortcutHint';
import { PageBreadcrumb } from '@/components/shell/PageBreadcrumb';
import { SubtaskSection } from '@/components/task/SubtaskSection';
import * as CompactButton from '@/components/ui/compact-button';
import * as Dropdown from '@/components/ui/dropdown';
import * as Label from '@/components/ui/label';
import * as Modal from '@/components/ui/modal';
import * as Select from '@/components/ui/select';
import { useServerValue } from '@/hooks/use-server-value';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { previewKind } from '@/lib/attachments';
import { formatInZone } from '@/lib/dates';
import { ATTACHMENT_PATH } from '@/lib/inline-attachment';
import { settle } from '@/lib/settle';
import { DETAIL_SELECTOR } from '@/lib/shortcuts/guards';
import { useShortcut } from '@/lib/shortcuts/provider';
import type { ShortcutId } from '@/lib/shortcuts/registry';
import type { FeedEntry } from '@/server/activity/queries';
import type { AttachmentView } from '@/server/attachments/queries';
import type { MemberRow } from '@/server/labels/queries';
import type { StatusRow } from '@/server/projects/queries';
import { deleteTaskAction, updateTaskAction } from '@/server/tasks/actions';
import type { LabelRow, Priority, TaskDetail } from '@/server/tasks/queries';
import type { ReminderOffset } from '@/lib/reminders';
import { Hint } from '@/components/shell/ShortcutHint';

const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high', 'urgent'];

function Field({ id, label, hint, footer, children }: {
  id: string;
  label: string;
  /** The shortcut that reaches this field, named in a hover hint. */
  hint?: ShortcutId;
  /** Under the control, outside the hint's hover area. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const field = (
    <div className="flex flex-col gap-1">
      <Label.Root htmlFor={id}>{label}</Label.Root>
      {children}
    </div>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {hint ? <ShortcutTooltip id={hint}>{field}</ShortcutTooltip> : field}
      {footer}
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
  /** My own reminders on this task. */
  reminders: ReminderOffset[];
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
  reminders,
  onDeleted,
}: TaskDetailViewProps & {
  mode: 'modal' | 'page';
  projectName?: string;
  /** Modal only: runs once the task is deleted, before the modal closes. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const confirm = useConfirm();
  const [title, setTitle] = useServerValue(task.title);
  // Field values are held here so a save the server rejects can put the old
  // value back; router.refresh() alone would not, as the server's is unchanged.
  const [assigneeId, setAssigneeId] = useServerValue(task.assigneeId);
  const [statusId, setStatusId] = useServerValue(task.statusId);
  const [priority, setPriority] = useServerValue<Priority>(task.priority);
  const [dueDate, setDueDate] = useServerValue(task.dueDate);
  // Controlled so s / p can open them from the keyboard.
  const [statusOpen, setStatusOpen] = useState(false);
  // One preview for the Attachments cards and for files linked inline in the description
  // and comments. Tracked by id so a refresh that adds or removes files keeps it open.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewable = (attachments ?? []).filter((a) => previewKind(a.fileName, a.contentType) !== null);
  const previewIndex = previewable.findIndex((a) => a.id === previewId);

  // A plain click on an inline attachment link previews it when the modal can show it;
  // anything else (another task's file, a zip, a modified click) stays a normal link.
  function onInlineAttachmentClick(event: React.MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest('a');
    // Links inside the editor do not navigate; a click there only places the caret.
    if (!link || link.closest('[contenteditable="true"]')) return;
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith(ATTACHMENT_PATH)) return;
    const id = href.slice(ATTACHMENT_PATH.length);
    if (!previewable.some((a) => a.id === id)) return;
    event.preventDefault();
    setPreviewId(id);
  }
  const [priorityOpen, setPriorityOpen] = useState(false);
  // Set when s / p opened the list. Radix hands focus back to the trigger on
  // close, where the next shortcut letter would pick an option by typeahead
  // (d → Done); the task itself takes focus instead.
  const openedByKey = useRef(false);
  function onSelectCloseAutoFocus(event: Event) {
    if (!openedByKey.current) return;
    openedByKey.current = false;
    event.preventDefault();
    document.querySelector<HTMLElement>(DETAIL_SELECTOR)?.focus();
  }

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

  function assign(next: string | null) {
    const previous = assigneeId;
    setAssigneeId(next);
    patch({ taskId: task.id, assigneeId: next }, () => setAssigneeId(previous));
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
        onDeleted?.();
        close();
        router.refresh();
      } else {
        // The page's own URL is gone now; land on what it hung off.
        router.replace(task.parentId ? `${tasksBase}/${task.parentId}` : projectHref);
      }
    });
  }

  // The fields' own controls, reached from the keyboard; no new UI.
  useShortcut('detail.title', () => {
    const input = document.getElementById('task-title') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  });
  useShortcut('detail.status', () => {
    openedByKey.current = true;
    setStatusOpen(true);
  });
  useShortcut('detail.priority', () => {
    openedByKey.current = true;
    setPriorityOpen(true);
  });
  useShortcut('detail.assignee', () => document.getElementById('task-assignee')?.click());
  useShortcut('detail.assignMe', () => {
    if (assigneeId !== currentUserId) assign(currentUserId);
  });
  useShortcut('detail.labels', () =>
    document.querySelector<HTMLElement>('[data-shortcut-target="labels"]')?.focus());
  useShortcut('detail.due', () => document.getElementById('task-due')?.click());

  // The rarer, destructive actions sit behind "⋯", as in Jira.
  const moreMenu = (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Hint label="More actions">
          <CompactButton.Root variant="ghost" size="large" aria-label="More actions">
            <CompactButton.Icon as={IconDots} aria-hidden="true" />
          </CompactButton.Root>
        </Hint>
      </Dropdown.Trigger>
      <Dropdown.Content align="end" className="w-48">
        <Dropdown.Item onSelect={onDelete} className="text-error-base">
          <Dropdown.ItemIcon as={IconTrash} className="text-error-base" />
          Delete
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown.Root>
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
        <Hint label="Copy link">
          <CompactButton.Root variant="ghost" size="large" onClick={copyLink} aria-label="Copy link">
            <CompactButton.Icon as={IconLink} aria-hidden="true" />
          </CompactButton.Root>
        </Hint>
        <Hint label="Open full page">
          <CompactButton.Root variant="ghost" size="large" asChild>
            <Link href={pageHref} aria-label="Open full page">
              <CompactButton.Icon as={IconArrowUpRight} aria-hidden="true" />
            </Link>
          </CompactButton.Root>
        </Hint>
        {moreMenu}
        <Modal.Close asChild>
          <Hint label="Close">
            <CompactButton.Root variant="ghost" size="large">
              <CompactButton.Icon as={IconX} aria-hidden="true" />
              <span className="sr-only">Close</span>
            </CompactButton.Root>
          </Hint>
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
        <Hint label="Copy link">
          <CompactButton.Root variant="ghost" size="large" onClick={copyLink} aria-label="Copy link">
            <CompactButton.Icon as={IconLink} aria-hidden="true" />
          </CompactButton.Root>
        </Hint>
        {moreMenu}
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
          <Field id="task-status" label="Status" hint="detail.status">
            <Select.Root
              open={statusOpen}
              onOpenChange={setStatusOpen}
              value={statusId}
              onValueChange={(next) => {
                const previous = statusId;
                setStatusId(next);
                patch({ taskId: task.id, statusId: next }, () => setStatusId(previous));
              }}
            >
              <Select.Trigger id="task-status"><Select.Value /></Select.Trigger>
              <Select.Content onCloseAutoFocus={onSelectCloseAutoFocus}>
                {statuses.map((s) => (
                  <Select.Item key={s.id} value={s.id}>
                    <StatusIcon status={s} />
                    {s.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field>

          <Field id="task-priority" label="Priority" hint="detail.priority">
            <Select.Root
              open={priorityOpen}
              onOpenChange={setPriorityOpen}
              value={priority}
              onValueChange={(value) => {
                const previous = priority;
                const next = value as Priority;
                setPriority(next);
                patch({ taskId: task.id, priority: next }, () => setPriority(previous));
              }}
            >
              <Select.Trigger id="task-priority"><Select.Value /></Select.Trigger>
              <Select.Content onCloseAutoFocus={onSelectCloseAutoFocus}>
                {PRIORITIES.map((p) => (
                  <Select.Item key={p} value={p}>
                    <PriorityIcon priority={p} />
                    {PRIORITY_LABEL[p]}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field>

          <Field
            id="task-assignee"
            label="Assignee"
            hint="detail.assignee"
            footer={assigneeId !== currentUserId && (
              <ShortcutTooltip id="detail.assignMe">
                <button
                  type="button"
                  onClick={() => assign(currentUserId)}
                  className="self-start text-paragraph-xs text-primary-base hover:underline"
                >
                  Assign to me
                </button>
              </ShortcutTooltip>
            )}
          >
            <AssigneePicker
              id="task-assignee"
              members={members}
              value={assigneeId}
              onChange={assign}
            />
          </Field>

          <ShortcutTooltip id="detail.due">
            <div>
              <DueDateField
                id="task-due"
                value={dueDate}
                done={statuses.find((s) => s.id === statusId)?.isDone ?? false}
                timezone={timezone}
                // A bare YYYY-MM-DD string, never a Date: the value is a calendar
                // day in the workspace zone (v1 spec §3.4).
                onChange={(next) => {
                  const previous = dueDate;
                  setDueDate(next);
                  patch({ taskId: task.id, dueDate: next }, () => setDueDate(previous));
                }}
              />
            </div>
          </ShortcutTooltip>
          <ReminderField
            id="task-reminders"
            workspaceSlug={workspaceSlug}
            taskId={task.id}
            value={reminders}
            hasDueDate={dueDate !== null}
          />

          <ShortcutTooltip id="detail.labels">
            <div className="flex flex-col gap-1">
              <span className="text-label-sm text-text-strong-950">Labels</span>
              <LabelPicker
                workspaceSlug={workspaceSlug}
                taskId={task.id}
                allLabels={allLabels}
                selected={task.labels}
              />
            </div>
          </ShortcutTooltip>

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

        <div
          onClick={onInlineAttachmentClick}
          className="flex flex-col gap-5 p-5 lg:col-start-1 lg:row-start-2 lg:overflow-y-auto"
        >
          <DescriptionField
            taskId={task.id}
            workspaceSlug={workspaceSlug}
            canAttach={attachments !== null}
            value={task.description}
            members={members}
            currentUserId={currentUserId}
            onSave={(description, revert) => patch({ taskId: task.id, description }, revert)}
          />

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
              onPreview={setPreviewId}
            />
          )}

          <ActivityFeed
            taskId={task.id}
            canAttach={attachments !== null}
            feed={feed}
            members={members}
            workspaceSlug={workspaceSlug}
            currentUserId={currentUserId}
            canModerate={canModerate}
            timezone={timezone}
          />
        </div>
      </div>

      <AttachmentPreviewModal
        attachments={previewable}
        index={previewIndex === -1 ? null : previewIndex}
        onIndexChange={(i) => setPreviewId(previewable[i].id)}
        onClose={() => setPreviewId(null)}
      />
    </>
  );
}
