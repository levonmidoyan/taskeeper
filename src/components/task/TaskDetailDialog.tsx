'use client';

import { IconChevronLeft, IconTrash } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TextField } from '@/components/forms/TextField';
import { ActivityFeed } from '@/components/task/ActivityFeed';
import { LabelPicker } from '@/components/task/LabelPicker';
import { RichTextField } from '@/components/task/RichTextField';
import { SubtaskSection } from '@/components/task/SubtaskSection';
import * as Button from '@/components/ui/button';
import * as Label from '@/components/ui/label';
import * as Modal from '@/components/ui/modal';
import * as Select from '@/components/ui/select';
import type { FeedEntry } from '@/server/activity/queries';
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

export function TaskDetailDialog({
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
}: {
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
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState(task.title);

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

  function patch(input: Parameters<typeof updateTaskAction>[1]) {
    startTransition(async () => {
      const result = await updateTaskAction(workspaceSlug, input);
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  function onDelete() {
    if (!confirm(`Delete "${task.title}"? This also deletes its subtasks.`)) return;
    startTransition(async () => {
      const result = await deleteTaskAction(workspaceSlug, { taskId: task.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <Modal.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Modal.Content aria-describedby={undefined} className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <Modal.Title className="sr-only">Task details</Modal.Title>

        <div className="flex flex-col gap-5 p-5 pt-14 sm:pt-5">
          {task.parentId && (
            <button
              type="button"
              onClick={openParent}
              className="-ml-1 inline-flex items-center gap-1 self-start rounded-lg px-1 py-1 text-paragraph-xs text-text-sub-600 transition-colors duration-150 hover:text-text-strong-950"
            >
              <IconChevronLeft className="size-3.5" aria-hidden="true" />
              {task.parentTitle}
            </button>
          )}

          <TextField
            id="task-title"
            label="Title"
            className="sm:pr-10"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            // Save on blur, not per keystroke, so one edit is one write.
            onBlur={() => title.trim() && title !== task.title && patch({ taskId: task.id, title })}
            maxLength={200}
          />

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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="task-status" label="Status">
              <Select.Root
                defaultValue={task.statusId}
                onValueChange={(statusId) => patch({ taskId: task.id, statusId })}
              >
                <Select.Trigger id="task-status"><Select.Value /></Select.Trigger>
                <Select.Content>
                  {statuses.map((s) => <Select.Item key={s.id} value={s.id}>{s.name}</Select.Item>)}
                </Select.Content>
              </Select.Root>
            </Field>

            <Field id="task-priority" label="Priority">
              <Select.Root
                defaultValue={task.priority}
                onValueChange={(priority) => patch({ taskId: task.id, priority: priority as Priority })}
              >
                <Select.Trigger id="task-priority"><Select.Value /></Select.Trigger>
                <Select.Content>
                  {PRIORITIES.map((p) => (
                    <Select.Item key={p} value={p}>
                      {p === 'none' ? 'No priority' : p[0].toUpperCase() + p.slice(1)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field>

            <Field id="task-assignee" label="Assignee">
              <Select.Root
                defaultValue={task.assigneeId ?? 'unassigned'}
                onValueChange={(value) =>
                  patch({ taskId: task.id, assigneeId: value === 'unassigned' ? null : value })
                }
              >
                <Select.Trigger id="task-assignee"><Select.Value /></Select.Trigger>
                <Select.Content>
                  <Select.Item value="unassigned">Unassigned</Select.Item>
                  {members.map((m) => <Select.Item key={m.userId} value={m.userId}>{m.name}</Select.Item>)}
                </Select.Content>
              </Select.Root>
            </Field>

            <TextField
              id="task-due"
              label="Due date"
              type="date"
              defaultValue={task.dueDate ?? ''}
              // A bare YYYY-MM-DD string, never a Date: the value is a calendar
              // day in the workspace zone (v1 spec §3.4).
              onChange={(e) => patch({ taskId: task.id, dueDate: e.target.value || null })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-label-sm text-text-strong-950">Labels</span>
            <LabelPicker
              workspaceSlug={workspaceSlug}
              taskId={task.id}
              allLabels={allLabels}
              selected={task.labels}
            />
          </div>

          {/* Depth is capped at one level: a subtask's dialog offers the way
              back to its parent instead of a nested list. */}
          {!task.parentId && (
            <SubtaskSection
              parent={task}
              subtasks={task.subtasks}
              statuses={statuses}
              projectId={projectId}
              workspaceSlug={workspaceSlug}
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

          <div className="border-t border-stroke-soft-200 pt-4">
            <Button.Root type="button" variant="error" mode="ghost" size="small" onClick={onDelete}>
              <Button.Icon as={IconTrash} />
              Delete task
            </Button.Root>
          </div>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}
