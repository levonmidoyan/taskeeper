'use client';

import { IconPlus, IconX } from '@tabler/icons-react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError, TextField } from '@/components/forms/TextField';
import { AssigneePicker } from '@/components/task/AssigneePicker';
import { DueDateField } from '@/components/task/DueDateField';
import { LabelSelect } from '@/components/task/LabelPicker';
import { PRIORITY_LABEL, PriorityIcon } from '@/components/task/Priority';
import { handleEditorEscape, RichTextField } from '@/components/task/RichTextField';
import { StatusIcon } from '@/components/task/StatusIcon';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import * as Label from '@/components/ui/label';
import * as Modal from '@/components/ui/modal';
import * as Select from '@/components/ui/select';
import * as Switch from '@/components/ui/switch';
import { ignoreShortcut } from '@/components/shell/shortcuts';
import { settle } from '@/lib/settle';
import type { ProjectSummary } from '@/server/projects/queries';
import {
  createTaskAction, getCreateTaskOptionsAction, type CreateTaskOptions,
} from '@/server/tasks/actions';
import type { Priority } from '@/server/tasks/queries';

const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high', 'urgent'];

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label.Root htmlFor={id}>{label}</Label.Root>
      {children}
    </div>
  );
}

/**
 * The header's Create button. Opens the full create form, laid out like the
 * task detail view so every field can be set before the task exists, as in
 * Jira. "c" opens it from anywhere.
 */
export function CreateTaskDialog({
  workspaceSlug,
  projects,
}: {
  workspaceSlug: string;
  projects: ProjectSummary[];
}) {
  const params = useParams<{ projectId?: string }>();
  const [open, setOpen] = useState(false);
  // Bumped per open, so the form always starts blank.
  const [session, setSession] = useState(0);
  const disabled = projects.length === 0;

  function onOpenChange(next: boolean) {
    if (next) setSession((n) => n + 1);
    setOpen(next);
  }

  useEffect(() => {
    if (disabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'c' || ignoreShortcut(e)) return;
      e.preventDefault();
      onOpenChange(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const initialProjectId = (projects.find((p) => p.id === params.projectId) ?? projects[0])?.id;

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Trigger asChild>
        <Button.Root
          size="small"
          disabled={disabled}
          title={disabled ? 'Create a project first' : 'Create task (C)'}
          aria-label="Create task"
          className="shrink-0 max-sm:w-9 max-sm:px-0"
        >
          <Button.Icon as={IconPlus} />
          <span className="max-sm:sr-only">Create</span>
        </Button.Root>
      </Modal.Trigger>
      <Modal.Content
        aria-describedby={undefined}
        showClose={false}
        // Same shell as the detail dialog: full screen on phones, the columns
        // scroll on their own inside a capped height from lg.
        overlayClassName="p-0 sm:p-4"
        className="flex h-dvh max-w-4xl flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[85vh] sm:rounded-20"
        onEscapeKeyDown={(event) => { if (handleEditorEscape(event)) event.preventDefault(); }}
      >
        {initialProjectId && (
          <CreateTaskForm
            key={session}
            workspaceSlug={workspaceSlug}
            projects={projects}
            initialProjectId={initialProjectId}
            onDone={() => setOpen(false)}
          />
        )}
      </Modal.Content>
    </Modal.Root>
  );
}

function CreateTaskForm({
  workspaceSlug,
  projects,
  initialProjectId,
  onDone,
}: {
  workspaceSlug: string;
  projects: ProjectSummary[];
  initialProjectId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [projectId, setProjectId] = useState(initialProjectId);
  const [loaded, setLoaded] = useState<{ projectId: string; options: CreateTaskOptions } | null>(null);
  const options = loaded?.projectId === projectId ? loaded.options : null;
  const [statusId, setStatusId] = useState<string | undefined>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Remounts the description editor, which only reads its value at mount.
  const [descriptionKey, setDescriptionKey] = useState(0);
  const [priority, setPriority] = useState<Priority>('none');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [createAnother, setCreateAnother] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Columns belong to the project, so a project change reloads them and
  // falls back to the new project's first column.
  useEffect(() => {
    let stale = false;
    settle(getCreateTaskOptionsAction(workspaceSlug, projectId)).then((result) => {
      if (stale) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLoaded({ projectId, options: result.data });
      setStatusId((current) => current || result.data.statuses[0]?.id);
    });
    return () => { stale = true; };
  }, [workspaceSlug, projectId]);

  function onProjectChange(next: string) {
    setProjectId(next);
    setStatusId(undefined);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusId || pending) return;
    setPending(true);
    setError(null);

    const result = await settle(createTaskAction(workspaceSlug, {
      projectId, title, statusId, description, priority, assigneeId, dueDate, labelIds,
    }));

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    // Open it over the view already showing this project, else its board.
    const projectPath = `/${workspaceSlug}/projects/${projectId}`;
    const base = pathname.startsWith(projectPath) ? pathname : projectPath;
    toast.success('Task created', {
      action: { label: 'Open', onClick: () => router.push(`${base}?task=${result.data.id}`) },
    });
    router.refresh();

    if (createAnother) {
      // Keep the fields a batch of tasks tends to share; clear what is per task.
      setTitle('');
      setDescription('');
      setDescriptionKey((n) => n + 1);
      document.getElementById('create-task-title')?.focus();
    } else {
      onDone();
    }
  }

  function onKeyDownCapture(event: React.KeyboardEvent<HTMLFormElement>) {
    // Captured before the editor, which would otherwise take Mod-Enter as a line break.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.requestSubmit();
    }
  }

  return (
    <form onSubmit={onSubmit} onKeyDownCapture={onKeyDownCapture} className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stroke-soft-200 px-5 py-3">
        <Modal.Title>New task</Modal.Title>
        <Modal.Close asChild>
          <CompactButton.Root variant="ghost" size="large">
            <CompactButton.Icon as={IconX} aria-hidden="true" />
            <span className="sr-only">Close</span>
          </CompactButton.Root>
        </Modal.Close>
      </header>

      <div className="grid min-h-0 flex-1 auto-rows-max overflow-y-auto lg:grid-cols-[minmax(0,1fr)_280px] lg:auto-rows-auto lg:overflow-hidden">
        <div className="flex flex-col gap-4 p-5 lg:overflow-y-auto">
          <Field id="create-task-project" label="Project">
            <Select.Root value={projectId} onValueChange={onProjectChange}>
              <Select.Trigger id="create-task-project"><Select.Value /></Select.Trigger>
              <Select.Content>
                {projects.map((p) => <Select.Item key={p.id} value={p.id}>{p.name}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </Field>

          <TextField
            id="create-task-title"
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            autoFocus
          />

          <div className="flex flex-col gap-1">
            <span id="create-task-description-label" className="text-label-sm text-text-strong-950">
              Description
            </span>
            <RichTextField
              key={descriptionKey}
              value=""
              labelledBy="create-task-description-label"
              placeholder="Add details… Type / for headings, lists and more."
              onChange={setDescription}
              className="[&_.md-content]:min-h-32"
            />
          </div>

          {error && <FormError>{error}</FormError>}
        </div>

        <aside
          aria-busy={!options}
          className="flex flex-col gap-4 border-t border-stroke-soft-200 p-5 lg:overflow-y-auto lg:border-l lg:border-t-0"
        >
          <Field id="create-task-status" label="Status">
            <Select.Root
              value={statusId}
              // Radix reports '' while the options are not rendered yet; that is not a pick.
              onValueChange={(next) => { if (next) setStatusId(next); }}
              disabled={!options}
            >
              <Select.Trigger id="create-task-status"><Select.Value placeholder="Loading…" /></Select.Trigger>
              <Select.Content>
                {options?.statuses.map((s) => (
                  <Select.Item key={s.id} value={s.id}>
                    <StatusIcon status={s} />
                    {s.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field>

          <Field id="create-task-priority" label="Priority">
            <Select.Root value={priority} onValueChange={(p) => setPriority(p as Priority)}>
              <Select.Trigger id="create-task-priority"><Select.Value /></Select.Trigger>
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

          {options && (
            <>
              <Field id="create-task-assignee" label="Assignee">
                <AssigneePicker
                  id="create-task-assignee"
                  members={options.members}
                  value={assigneeId}
                  onChange={setAssigneeId}
                />
              </Field>

              <DueDateField
                id="create-task-due"
                value={dueDate}
                timezone={options.timezone}
                onChange={setDueDate}
              />

              <div className="flex flex-col gap-1">
                <span className="text-label-sm text-text-strong-950">Labels</span>
                <LabelSelect
                  workspaceSlug={workspaceSlug}
                  allLabels={options.labels}
                  value={labelIds}
                  onChange={setLabelIds}
                />
              </div>
            </>
          )}
        </aside>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-stroke-soft-200 px-5 py-3">
        <label className="flex items-center gap-2 text-paragraph-sm text-text-sub-600">
          <Switch.Root checked={createAnother} onCheckedChange={setCreateAnother} />
          Create another
        </label>
        <div className="flex items-center gap-2">
          <Modal.Close asChild>
            <Button.Root type="button" variant="neutral" mode="stroke" size="small">
              Cancel
            </Button.Root>
          </Modal.Close>
          <Button.Root
            type="submit"
            size="small"
            disabled={pending || !statusId}
            title="Create task (Ctrl+Enter)"
          >
            {pending ? 'Creating…' : 'Create task'}
          </Button.Root>
        </div>
      </footer>
    </form>
  );
}
