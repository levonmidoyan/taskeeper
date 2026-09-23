'use client';

import { Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LabelPicker } from '@/components/task/LabelPicker';
import type { StatusRow } from '@/server/projects/queries';
import type { MemberRow } from '@/server/labels/queries';
import { deleteTaskAction, updateTaskAction } from '@/server/tasks/actions';
import type { LabelRow, Priority, TaskRow } from '@/server/tasks/queries';

const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high', 'urgent'];

export function TaskDetailPanel({
  task,
  statuses,
  members,
  allLabels,
  workspaceSlug,
}: {
  task: TaskRow;
  statuses: StatusRow[];
  members: MemberRow[];
  allLabels: LabelRow[];
  workspaceSlug: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);

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
    <Sheet open onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-[480px]">
        <SheetTitle className="sr-only">Task details</SheetTitle>

        <div className="space-y-5 p-5">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              // Save on blur, not per keystroke, so one edit is one write.
              onBlur={() =>
                title.trim() && title !== task.title && patch({ taskId: task.id, title })
              }
              maxLength={200}
              className="h-11 text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-description">Description</Label>
            <textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() =>
                description !== task.description && patch({ taskId: task.id, description })
              }
              rows={6}
              maxLength={10000}
              className="w-full rounded-[var(--radius-card)] border border-border bg-card p-3 text-base text-foreground lg:text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-status">Status</Label>
              <Select
                defaultValue={task.statusId}
                onValueChange={(statusId) => patch({ taskId: task.id, statusId })}
              >
                <SelectTrigger id="task-status" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-priority">Priority</Label>
              <Select
                defaultValue={task.priority}
                onValueChange={(priority) =>
                  patch({ taskId: task.id, priority: priority as Priority })
                }
              >
                <SelectTrigger id="task-priority" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p === 'none' ? 'No priority' : p[0].toUpperCase() + p.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-assignee">Assignee</Label>
              <Select
                defaultValue={task.assigneeId ?? 'unassigned'}
                onValueChange={(value) =>
                  patch({ taskId: task.id, assigneeId: value === 'unassigned' ? null : value })
                }
              >
                <SelectTrigger id="task-assignee" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                defaultValue={task.dueDate ?? ''}
                // A bare YYYY-MM-DD string, never a Date: the value is a calendar
                // day in the workspace zone (spec §3.4).
                onChange={(e) => patch({ taskId: task.id, dueDate: e.target.value || null })}
                className="h-11 text-base"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Labels</Label>
            <LabelPicker
              workspaceSlug={workspaceSlug}
              taskId={task.id}
              allLabels={allLabels}
              selected={task.labels}
            />
          </div>

          <div className="border-t border-border pt-4">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-button)] px-3 text-sm text-destructive transition-colors duration-150 hover:bg-destructive/10"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete task
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
