# UI Reset — Part 3: Tasks, Task Dialog, and the Markdown Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the task list, the home page and the task detail dialog on Align UI, and replace the three plain textareas (description, new comment, edit comment) with Kibo's Tiptap editor storing Markdown, rendered safely everywhere.

**Architecture:** Task chips (priority, due, label, assignee) become small Align-based components shared by the list, the home page and (in Part 4) the board. Markdown is stored as-is in the existing text columns. Display goes through one `<Markdown>` component (react-markdown, raw HTML shown as literal text). Editing goes through one `RichTextField` built on a trimmed copy of Kibo's editor with `@tiptap/markdown`; raw HTML is kept as literal text there too, so existing plain-text rows never lose characters.

**Tech Stack:** as Parts 1–2, plus Tiptap 3.31.3 (`@tiptap/react`, `core`, `pm`, `starter-kit`, `extension-list`, `extensions`, `suggestion`, `markdown`), `cmdk` 1.1.1, `tippy.js` 6.3.7, `@floating-ui/dom` 1.8.0, `react-markdown` 10.1.0, `remark-gfm` 4.0.1, `remark-breaks` 4.0.0; dev `jsdom` 30.1.1.

**Spec:** `docs/superpowers/specs/2026-09-24-ui-reset-design.md` (§4, §6, §10).

**Plan series:** Part 1 → Part 2 (both complete) → **Part 3 (this)** → Part 4 (`…-part-4-kanban-cleanup.md`).

## Global Constraints

- Work on branch `feat/ui-reset`. Commit after every task. Conventional Commits, **no `Co-Authored-By` or any attribution trailer**.
- Do not change the `version` field in `package.json`. Pin new dependencies exactly (`yarn add -E`).
- `AGENTS.md`: read the matching guide in `node_modules/next/dist/docs/` before writing Next-specific code.
- Icons only from `@tabler/icons-react`. New code uses Align components/tokens only — no `@/components/legacy-ui/*`, no bridged shadcn names, no hex colours.
- Accessible names from spec §4.1 are preserved exactly: `Title`, `Priority`, `Status`, `Assignee`, `Due date`, `Comment` (label and button), `Mark "<title>" as done`, `Mark "<title>" as not done`, `Delete "<title>"`, the task title button, placeholders `Add a task…`, `Add a subtask…`, `Add to <status>…`, `dialog`, `option "High"`.
- The only e2e change in the whole reset is the one new test in Task 5 Step 7.
- Kibo copies carry a header naming upstream path + commit (`haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263`) and every adaptation.
- Gate at the end of every task: `yarn typecheck && yarn lint && yarn test`; plus `yarn e2e` at the end of Tasks 1, 4 and 5.

## Review Focus

- **Existing plain-text rows containing `<` or HTML-like text** (`use <div> tags`) → must display and edit with every character intact; Markdown parsers drop raw HTML by default (Task 2 and Task 3 tests pin this).
- **Opening a task and leaving the description without typing** → must not write anything; loading plain text into the editor normalises it (a single newline becomes a hard break), so "changed" is judged against what the editor loaded, not the stored string (Task 3 `RichTextField`; Task 4 Step 6 checks by hand).
- **Links** → `javascript:` and other non-web schemes must be rejected when set in the editor and neutralised when rendered; rendered links open in a new tab with `rel="noopener noreferrer"` (Task 2 and Task 3 tests pin this).
- **Typing in the label picker's name field** → Radix menus steal printable keys for typeahead; the field must keep focus while typing (Task 4 `LabelPicker`).
- **A comment longer than 10 000 characters or a description over 10 000** → the server rejects it with a toast (existing zod limits); nothing in the editor silently truncates.

---

### Task 1: Task chips, task list, quick add, and the home page

**Files:**
- Modify (full rewrite): `src/components/task/PriorityDot.tsx`, `src/components/task/DueChip.tsx`, `src/components/task/TaskRow.tsx`, `src/components/task/TaskList.tsx`, `src/components/task/QuickAddTask.tsx`, `src/app/(app)/[workspaceSlug]/page.tsx`
- Create: `src/components/task/AssigneeAvatar.tsx`, `src/components/task/LabelChip.tsx`

**Interfaces:**
- Produces (Part 4's `TaskCard` uses all four):
  - `PriorityDot({ priority: Priority })` — renders nothing for `none`; text is the priority name with an sr-only "Priority: " prefix.
  - `DueChip({ dueDate: string | null; timezone: string })` — nothing when null; an Align red Badge with sr-only "Overdue. " when overdue.
  - `AssigneeAvatar({ name: string; className?: string })` — 24px Align avatar, `role="img"`, `aria-label="Assigned to <name>"`.
  - `LabelChip({ name: string; className?: string })` — small gray Align badge.

- [ ] **Step 1: Chips**

Replace `src/components/task/PriorityDot.tsx`:

```tsx
import type { Priority } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};

const PRIORITY_DOT: Record<Priority, string> = {
  none: 'bg-faded-light',
  low: 'bg-faded-base',
  medium: 'bg-information-base',
  high: 'bg-warning-base',
  urgent: 'bg-error-base',
};

export function PriorityDot({ priority }: { priority: Priority }) {
  if (priority === 'none') return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-paragraph-xs text-text-sub-600">
      <span className={cn('size-2 rounded-full', PRIORITY_DOT[priority])} aria-hidden="true" />
      <span className="sr-only">Priority: </span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
```

Replace `src/components/task/DueChip.tsx`:

```tsx
import { IconCalendarDue } from '@tabler/icons-react';
import * as Badge from '@/components/ui/badge';
import { formatDueDate, isOverdue } from '@/lib/dates';

export function DueChip({ dueDate, timezone }: { dueDate: string | null; timezone: string }) {
  if (!dueDate) return null;

  if (isOverdue(dueDate, timezone)) {
    return (
      <Badge.Root variant="lighter" color="red" size="medium" className="tabular">
        <Badge.Icon as={IconCalendarDue} />
        {/* The word "Overdue" carries the meaning; the red is reinforcement only. */}
        <span className="sr-only">Overdue. </span>
        Due {formatDueDate(dueDate, timezone)}
      </Badge.Root>
    );
  }

  return (
    <span className="tabular inline-flex items-center gap-1 text-paragraph-xs text-text-sub-600">
      <IconCalendarDue className="size-3.5" aria-hidden="true" />
      Due {formatDueDate(dueDate, timezone)}
    </span>
  );
}
```

Create `src/components/task/AssigneeAvatar.tsx`:

```tsx
import * as Avatar from '@/components/ui/avatar';

export function AssigneeAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar.Root size="24" color="blue" role="img" aria-label={`Assigned to ${name}`} className={className}>
      {name.slice(0, 1)}
    </Avatar.Root>
  );
}
```

Create `src/components/task/LabelChip.tsx`:

```tsx
import * as Badge from '@/components/ui/badge';

export function LabelChip({ name, className }: { name: string; className?: string }) {
  return (
    <Badge.Root variant="lighter" color="gray" size="medium" className={className}>
      {name}
    </Badge.Root>
  );
}
```

- [ ] **Step 2: Task row**

Replace `src/components/task/TaskRow.tsx`:

```tsx
'use client';

import { IconCircle, IconCircleCheckFilled } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DueChip } from '@/components/task/DueChip';
import { LabelChip } from '@/components/task/LabelChip';
import { PriorityDot } from '@/components/task/PriorityDot';
import { doneToggleTarget } from '@/lib/task-done';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow as TaskRowData } from '@/server/tasks/queries';
import { updateTaskAction } from '@/server/tasks/actions';
import { cn } from '@/utils/cn';

export function TaskRow({
  task,
  statuses,
  workspaceSlug,
  timezone,
}: {
  task: TaskRowData;
  statuses: StatusRow[];
  workspaceSlug: string;
  timezone: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const done = task.completedAt !== null;

  function toggleDone() {
    const target = doneToggleTarget(statuses, done);
    if (!target) {
      toast.error('This project has no done column.');
      return;
    }
    startTransition(async () => {
      const result = await updateTaskAction(workspaceSlug, {
        taskId: task.id, statusId: target.id,
      });
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  function openDetail() {
    const next = new URLSearchParams(searchParams);
    next.set('task', task.id);
    // Deep-linkable and back-dismissable (v1 spec §6.3).
    router.push(`?${next.toString()}`, { scroll: false });
  }

  return (
    <li className="flex items-center gap-2 border-b border-stroke-soft-200 px-2 transition-colors duration-150 last:border-b-0 hover:bg-bg-weak-50">
      {/* A toggle button, not a checkbox: e2e and screen readers know it by this name
          (spec §10 A2). */}
      <button
        type="button"
        onClick={toggleDone}
        disabled={pending}
        aria-pressed={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-soft-400 transition-colors duration-150 hover:text-text-strong-950 disabled:opacity-50"
      >
        {done
          ? <IconCircleCheckFilled className="size-5 text-success-base" aria-hidden="true" />
          : <IconCircle className="size-5" aria-hidden="true" />}
      </button>

      <button
        type="button"
        onClick={openDetail}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-paragraph-sm',
            done ? 'text-text-soft-400 line-through' : 'text-text-strong-950',
          )}
        >
          {task.title}
        </span>

        {task.labels.map((label) => (
          <LabelChip key={label.id} name={label.name} className="hidden shrink-0 sm:inline-flex" />
        ))}

        {task.subtaskCount > 0 && (
          <span className="tabular hidden shrink-0 text-paragraph-xs text-text-sub-600 sm:inline">
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        )}

        <PriorityDot priority={task.priority} />
        <DueChip dueDate={task.dueDate} timezone={timezone} />

        {task.assigneeName && (
          <AssigneeAvatar name={task.assigneeName} className="hidden shrink-0 sm:flex" />
        )}
      </button>
    </li>
  );
}
```

- [ ] **Step 3: Task list and quick add**

Replace `src/components/task/TaskList.tsx`:

```tsx
import { QuickAddTask } from '@/components/task/QuickAddTask';
import { TaskRow } from '@/components/task/TaskRow';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow as TaskRowData } from '@/server/tasks/queries';

export function TaskList({
  tasks,
  statuses,
  workspaceSlug,
  projectId,
  timezone,
}: {
  tasks: TaskRowData[];
  statuses: StatusRow[];
  workspaceSlug: string;
  projectId: string;
  timezone: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6">
      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stroke-sub-300 p-8 text-center">
          <p className="text-label-sm text-text-strong-950">No tasks yet</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">Type below to add the first one.</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-bg-white-0 ring-1 ring-inset ring-stroke-soft-200">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              statuses={statuses}
              workspaceSlug={workspaceSlug}
              timezone={timezone}
            />
          ))}
        </ul>
      )}

      <div className="mt-2 rounded-2xl bg-bg-white-0 px-3 ring-1 ring-inset ring-stroke-soft-200">
        <QuickAddTask workspaceSlug={workspaceSlug} projectId={projectId} />
      </div>
    </div>
  );
}
```

Replace `src/components/task/QuickAddTask.tsx` (same logic, Align look):

```tsx
'use client';

import { IconPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { createTaskAction } from '@/server/tasks/actions';

export function QuickAddTask({
  workspaceSlug,
  projectId,
  statusId,
  placeholder = 'Add a task…',
}: {
  workspaceSlug: string;
  projectId: string;
  statusId?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = inputRef.current?.value.trim();
    if (!title || pending) return;

    // Cleared up front, not after the round trip: the field has to be ready for
    // the next title immediately, which is the whole point of quick add. The
    // input is never disabled either — disabling blurs it, and re-enabling does
    // not restore focus, so the second task could not be typed without reaching
    // for the mouse.
    if (inputRef.current) inputRef.current.value = '';

    setPending(true);
    const result = await createTaskAction(workspaceSlug, { projectId, title, statusId });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      // Hand the title back rather than losing what was typed, but only if the
      // user has not already started the next one.
      if (inputRef.current && inputRef.current.value === '') inputRef.current.value = title;
      return;
    }

    router.refresh();
  }

  return (
    // relative, so the sr-only label below resolves its containing block here
    // rather than at the viewport. In the board's horizontally scrolling strip
    // an unpositioned absolute label escapes the scroll container and stretches
    // the page itself sideways.
    <form onSubmit={onSubmit} className="relative flex items-center gap-2">
      <IconPlus className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
      <label htmlFor={`quick-add-${statusId ?? 'default'}`} className="sr-only">
        {placeholder}
      </label>
      <input
        id={`quick-add-${statusId ?? 'default'}`}
        ref={inputRef}
        name="title"
        maxLength={200}
        aria-busy={pending}
        placeholder={placeholder}
        className="h-11 w-full bg-transparent text-paragraph-md text-text-strong-950 placeholder:text-text-soft-400 lg:text-paragraph-sm"
      />
    </form>
  );
}
```

- [ ] **Step 4: Home page ("My tasks")**

Replace `src/app/(app)/[workspaceSlug]/page.tsx`:

```tsx
import Link from 'next/link';
import { DueChip } from '@/components/task/DueChip';
import { PriorityDot } from '@/components/task/PriorityDot';
import { requireWorkspace } from '@/lib/session';
import { listMyOpenTasks } from '@/server/tasks/queries';

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const tasks = await listMyOpenTasks(ctx);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pl-16 lg:px-6 lg:pl-6">
      <h1 className="text-title-h5 text-text-strong-950">My tasks</h1>
      <p className="mt-1 text-paragraph-sm text-text-sub-600">
        Open work assigned to you across every project.
      </p>

      {tasks.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-stroke-sub-300 p-8 text-center">
          <p className="text-label-sm text-text-strong-950">Nothing assigned to you</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">
            Open a project from the sidebar to pick up work.
          </p>
        </div>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-2xl bg-bg-white-0 ring-1 ring-inset ring-stroke-soft-200">
          {tasks.map((task) => (
            <li key={task.id} className="border-b border-stroke-soft-200 last:border-b-0">
              <Link
                href={`/${workspaceSlug}/projects/${task.projectId}?task=${task.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-bg-weak-50"
              >
                <span className="min-w-0 flex-1 truncate text-paragraph-sm text-text-strong-950">
                  {task.title}
                </span>
                <span className="hidden shrink-0 text-paragraph-xs text-text-sub-600 sm:inline">
                  {task.projectName}
                </span>
                <PriorityDot priority={task.priority} />
                <DueChip dueDate={task.dueDate} timezone={ctx.timezone} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Gate, e2e, visual**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass. (`src/components/board/TaskCard.tsx` still renders `PriorityDot`/`DueChip` — the props are unchanged, so it compiles.)

Run: `yarn e2e`
Expected: all pass.

Run `scripts/screenshots.mjs`; review `list-*` and `home-*` in both themes and widths. Tab through a row: the done toggle and the title each show a focus ring.

- [ ] **Step 6: Commit**

```bash
git add src/components/task "src/app/(app)/[workspaceSlug]/page.tsx"
git commit -m "feat(ui): rebuild task list, chips and home page on Align"
```

---

### Task 2: Safe Markdown rendering

**Files:**
- Create: `src/components/task/Markdown.tsx`
- Modify: `src/app/globals.css` (append `.md-content` styles)
- Test: `tests/unit/markdown.test.ts`

**Interfaces:**
- Produces: `Markdown({ children: string; className?: string })` (server-safe, no hooks); `remarkHtmlAsText()` remark plugin (exported for tests); CSS class `.md-content` used by both `Markdown` and the editor (Task 3).

- [ ] **Step 1: Dependencies**

```bash
yarn add -E react-markdown@10.1.0 remark-gfm@4.0.1 remark-breaks@4.0.0
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/markdown.test.ts`:

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/components/task/Markdown';

const render = (md: string) => renderToStaticMarkup(createElement(Markdown, null, md));

describe('Markdown', () => {
  it('renders emphasis, lists and task lists', () => {
    expect(render('Ship **today**')).toContain('<strong>today</strong>');
    expect(render('- one\n- two')).toContain('<li>one</li>');
    expect(render('- [x] done')).toContain('type="checkbox"');
  });

  it('keeps single line breaks from old plain-text rows', () => {
    expect(render('line one\nline two')).toMatch(/line one<br\/?>/);
  });

  it('shows raw HTML as literal text instead of dropping or executing it', () => {
    // Old rows are plain text; "use <div> tags" must not lose "<div>".
    expect(render('use <div> tags')).toContain('use &lt;div&gt; tags');
    const script = render('<script>alert(1)</script>');
    expect(script).not.toContain('<script');
    expect(script).toContain('&lt;script&gt;');
    expect(render('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });

  it('neutralises javascript: links and opens real links safely', () => {
    expect(render('[x](javascript:alert(1))')).not.toContain('javascript:');
    const link = render('[site](https://example.com)');
    expect(link).toContain('href="https://example.com"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  });

  it('wraps output in the shared md-content class', () => {
    expect(render('hi')).toMatch(/^<div class="md-content/);
  });
});
```

Run: `yarn test tests/unit/markdown.test.ts`
Expected: FAIL with `Failed to resolve import "@/components/task/Markdown"`.

- [ ] **Step 3: Implement**

Create `src/components/task/Markdown.tsx`:

```tsx
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { cn } from '@/utils/cn';

type MdNode = { type: string; children?: MdNode[] };

/**
 * Descriptions and comments were plain text before the editor existed, so "<div>" in one
 * is a word, not markup. react-markdown drops raw HTML; turning html nodes into text nodes
 * shows it literally instead (never as HTML — rehype-raw is deliberately not used).
 */
export function remarkHtmlAsText() {
  const walk = (node: MdNode) => {
    if (node.type === 'html') node.type = 'text';
    node.children?.forEach(walk);
  };
  return (tree: MdNode) => walk(tree);
}

const components: Components = {
  // react-markdown's default URL transform has already emptied unsafe hrefs
  // (javascript:, data:, …) by the time this runs.
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('md-content', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkHtmlAsText]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
```

Append to `src/app/globals.css`:

```css
/* Markdown, rendered (components/task/Markdown.tsx) and edited (kibo-ui/editor). */
@layer components {
  .md-content {
    @apply text-paragraph-sm text-text-strong-950 [overflow-wrap:anywhere];
  }
  .md-content > :where(* + *) { @apply mt-2; }
  .md-content :where(h1) { @apply text-label-lg; }
  .md-content :where(h2) { @apply text-label-md; }
  .md-content :where(h3) { @apply text-label-sm; }
  .md-content :where(ul) { @apply list-outside list-disc pl-5; }
  .md-content :where(ol) { @apply list-outside list-decimal pl-5; }
  .md-content :where(ul.contains-task-list, ul[data-type="taskList"]) { @apply list-none pl-0; }
  .md-content :where(li[data-type="taskItem"], li.task-list-item) { @apply flex items-start gap-2; }
  .md-content :where(li > p) { @apply m-0; }
  .md-content :where(blockquote) { @apply border-l-2 border-stroke-soft-200 pl-3 text-text-sub-600; }
  .md-content :where(code) { @apply rounded-md bg-bg-weak-50 px-1 py-0.5 font-mono text-[0.9em]; }
  .md-content :where(pre) { @apply overflow-x-auto rounded-10 bg-bg-weak-50 p-3 font-mono text-paragraph-xs; }
  .md-content :where(pre code) { @apply bg-transparent p-0; }
  .md-content :where(a) { @apply text-primary-base underline underline-offset-2; }
  .md-content :where(hr) { @apply border-stroke-soft-200; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test tests/unit/markdown.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Gate and commit**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`
Expected: all pass.

```bash
git add package.json yarn.lock src/components/task/Markdown.tsx src/app/globals.css tests/unit/markdown.test.ts
git commit -m "feat(ui): safe Markdown rendering for descriptions and comments"
```

---

### Task 3: Kibo editor (trimmed), Markdown I/O, and `RichTextField`

**Files:**
- Create: `src/components/kibo-ui/editor/extensions.ts` — Markdown-capable extension set + load/read helpers (no React)
- Create: `src/components/kibo-ui/editor/slash-items.ts` — slash menu items + filter (no DOM)
- Create: `src/components/kibo-ui/editor/link.ts` — link URL normaliser (pure)
- Create: `src/components/kibo-ui/editor/slash.tsx` — slash command extension and menu
- Create: `src/components/kibo-ui/editor/index.tsx` — `EditorProvider`, `EditorBubbleMenu`, format buttons, link control
- Create: `src/components/task/RichTextField.tsx`
- Test: `tests/unit/editor-markdown.test.ts` (jsdom), `tests/unit/editor-helpers.test.ts`

**Interfaces:**
- Produces:
  - `markdownExtensions(): AnyExtension[]`; `loadMarkdown(editor: Editor, markdown: string): void`; `readMarkdown(editor: Editor): string` from `@/components/kibo-ui/editor/extensions`.
  - `filterSlashItems(query: string): SlashItem[]` from `…/slash-items`; `normalizeLinkUrl(input: string): string | null` from `…/link`.
  - `EditorProvider`, `EditorBubbleMenu`, `EditorFormatBold`, `EditorFormatItalic`, `EditorFormatStrike`, `EditorFormatCode`, `EditorLinkControl` from `@/components/kibo-ui/editor`.
  - `RichTextField({ value: string; label?: string; labelledBy?: string; placeholder?: string; onChange?: (md: string) => void; onCommit?: (md: string) => void; className?: string })` — `value` is read once at mount (remount with `key` to reset); `onCommit` fires on blur only when the Markdown differs from what was loaded or last committed.

- [ ] **Step 1: Dependencies**

```bash
yarn add -E @tiptap/react@3.31.3 @tiptap/core@3.31.3 @tiptap/pm@3.31.3 \
  @tiptap/starter-kit@3.31.3 @tiptap/extension-list@3.31.3 @tiptap/extensions@3.31.3 \
  @tiptap/suggestion@3.31.3 @tiptap/markdown@3.31.3 \
  cmdk@1.1.1 tippy.js@6.3.7 @floating-ui/dom@1.8.0
yarn add -E -D jsdom@30.1.1
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/editor-markdown.test.ts`:

```ts
// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMarkdown, markdownExtensions, readMarkdown } from '@/components/kibo-ui/editor/extensions';

const editors: Editor[] = [];
function open(markdown: string) {
  const editor = new Editor({ extensions: markdownExtensions() });
  loadMarkdown(editor, markdown);
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

describe('editor Markdown round trip', () => {
  it.each([
    '**bold** and *italic*',
    '~~gone~~',
    '`code`',
    '# Title',
    '## Sub',
    '### Small',
    '- one\n- two',
    '1. one\n2. two',
    '- [ ] todo\n- [x] done',
    '> quoted',
    '```\nconst a = 1;\n```',
    '[site](https://example.com)',
  ])('keeps %j', (markdown) => {
    expect(readMarkdown(open(markdown))).toBe(markdown);
  });

  it('is stable: saving what it loaded changes nothing further', () => {
    for (const markdown of ['line one\nline two', 'a < b', 'use <div> tags', '- [ ] todo']) {
      const once = readMarkdown(open(markdown));
      expect(readMarkdown(open(once))).toBe(once);
    }
  });

  it('keeps raw HTML in old plain-text rows as literal text', () => {
    expect(open('use <div> tags').getText()).toBe('use <div> tags');
    expect(open('<script>alert(1)</script>').getText()).toBe('<script>alert(1)</script>');
    expect(open('wrap <b>this</b>').getText()).toBe('wrap <b>this</b>');
  });

  it('turns a single newline into a hard break', () => {
    const editor = open('line one\nline two');
    expect(JSON.stringify(editor.getJSON())).toContain('hardBreak');
    expect(editor.getText()).toBe('line one\nline two');
  });

  it('has no underline (no Markdown form)', () => {
    expect(open('x').extensionManager.extensions.map((e) => e.name)).not.toContain('underline');
  });
});
```

Create `tests/unit/editor-helpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeLinkUrl } from '@/components/kibo-ui/editor/link';
import { filterSlashItems } from '@/components/kibo-ui/editor/slash-items';

describe('normalizeLinkUrl', () => {
  it('accepts web and mail links', () => {
    expect(normalizeLinkUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(normalizeLinkUrl('http://example.com')).toBe('http://example.com/');
    expect(normalizeLinkUrl('mailto:a@b.co')).toBe('mailto:a@b.co');
  });

  it('adds https:// to a bare domain', () => {
    expect(normalizeLinkUrl('example.com/docs')).toBe('https://example.com/docs');
  });

  it('rejects scripts, other schemes and junk', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('data:text/html,hi')).toBeNull();
    expect(normalizeLinkUrl('not a url')).toBeNull();
    expect(normalizeLinkUrl('   ')).toBeNull();
  });
});

describe('filterSlashItems', () => {
  it('returns every item for an empty query', () => {
    expect(filterSlashItems('').map((i) => i.title)).toEqual([
      'Text', 'To-do list', 'Heading 1', 'Heading 2', 'Heading 3',
      'Bullet list', 'Numbered list', 'Quote', 'Code block',
    ]);
  });

  it('matches titles and search terms, case-insensitively', () => {
    expect(filterSlashItems('HEAD').map((i) => i.title)).toEqual(['Heading 1', 'Heading 2', 'Heading 3']);
    expect(filterSlashItems('todo').map((i) => i.title)).toEqual(['To-do list']);
    expect(filterSlashItems('zzz')).toEqual([]);
  });
});
```

Run: `yarn test tests/unit/editor-markdown.test.ts tests/unit/editor-helpers.test.ts`
Expected: FAIL with `Failed to resolve import "@/components/kibo-ui/editor/extensions"`.

- [ ] **Step 3: Extensions and Markdown I/O**

Create `src/components/kibo-ui/editor/extensions.ts`:

```ts
/**
 * Editor extension set — trimmed from Kibo UI's editor
 * (haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263, packages/editor/index.tsx):
 * only nodes and marks with a Markdown form are kept (spec §6.1). Dropped: tables,
 * sub/superscript, text style, underline, lowlight, character count, typography (it rewrites
 * "--" and quotes as you type, which mangles CLI flags and code in descriptions).
 * Added: @tiptap/markdown for Markdown in and out.
 */
import type { AnyExtension, Editor } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

type HtmlToken = { text?: string; raw?: string; block?: boolean };
type MarkdownManagerInternals = {
  parseHTMLToken(token: HtmlToken): unknown;
  htmlAsLiteralText(html: string, block: boolean): unknown;
};

/**
 * Stored text was plain text before this editor existed, so "<div>" in it is a word. The
 * stock parser turns known HTML into nodes and drops the rest ("use <div> tags" becomes
 * "use  tags"); routing every HTML token through the manager's own literal-text path keeps
 * every character. Uses @tiptap/markdown 3.31.3 internals — tests/unit/editor-markdown.test.ts
 * fails loudly if an upgrade renames them.
 */
const LiteralHtmlMarkdown = Markdown.extend({
  onBeforeCreate() {
    this.parent?.();
    const manager = this.editor.markdown as unknown as MarkdownManagerInternals | undefined;
    if (!manager) return;
    manager.parseHTMLToken = (token) => {
      const html = token.text || token.raw || '';
      return html.trim() ? manager.htmlAsLiteralText(html, !!token.block) : null;
    };
  },
});

export function markdownExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      dropcursor: { color: 'var(--color-primary-base)', width: 2 },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // breaks: a single newline is a line break, as it was in the old plain text.
    LiteralHtmlMarkdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}

/**
 * Loads Markdown after the editor exists. Passing it as initial `content` would parse it
 * inside the Markdown extension's own onBeforeCreate — before LiteralHtmlMarkdown's patch.
 */
export function loadMarkdown(editor: Editor, markdown: string) {
  editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
}

export function readMarkdown(editor: Editor) {
  return editor.getMarkdown().trim();
}
```

- [ ] **Step 4: Pure helpers**

Create `src/components/kibo-ui/editor/link.ts`:

```ts
const ALLOWED = new Set(['http:', 'https:', 'mailto:']);

/**
 * Kibo's link selector accepted anything `new URL()` parses — including javascript:.
 * Only web and mail links are allowed; a bare domain gets https://.
 */
export function normalizeLinkUrl(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;

  const candidates = /^[a-z][a-z0-9+.-]*:/i.test(text) ? [text] : [`https://${text}`];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (!ALLOWED.has(url.protocol)) return null;
      if (url.protocol !== 'mailto:' && !url.hostname.includes('.')) return null;
      return url.toString();
    } catch {
      return null;
    }
  }
  return null;
}
```

Create `src/components/kibo-ui/editor/slash-items.ts`:

```ts
import type { Editor, Range } from '@tiptap/core';
import {
  IconH1, IconH2, IconH3, IconList, IconListCheck, IconListNumbers, IconQuote,
  IconSourceCode, IconTypography, type TablerIcon,
} from '@tabler/icons-react';

export type SlashItem = {
  title: string;
  description: string;
  searchTerms: string[];
  icon: TablerIcon;
  command: (props: { editor: Editor; range: Range }) => void;
};

/** Kibo's default slash suggestions, minus Table (no Markdown form in our set). */
export const slashItems: SlashItem[] = [
  {
    title: 'Text', description: 'Just start typing with plain text.', searchTerms: ['p', 'paragraph'],
    icon: IconTypography,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: 'To-do list', description: 'Track tasks with a to-do list.',
    searchTerms: ['todo', 'task', 'check', 'checkbox'], icon: IconListCheck,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Heading 1', description: 'Big section heading.', searchTerms: ['title', 'big', 'large'],
    icon: IconH1,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2', description: 'Medium section heading.', searchTerms: ['subtitle', 'medium'],
    icon: IconH2,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3', description: 'Small section heading.', searchTerms: ['subtitle', 'small'],
    icon: IconH3,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Bullet list', description: 'Create a simple bullet list.', searchTerms: ['unordered', 'point'],
    icon: IconList,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list', description: 'Create a list with numbering.', searchTerms: ['ordered'],
    icon: IconListNumbers,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Quote', description: 'Capture a quote.', searchTerms: ['blockquote'], icon: IconQuote,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setParagraph().toggleBlockquote().run(),
  },
  {
    title: 'Code block', description: 'Capture a code snippet.', searchTerms: ['codeblock', 'pre'],
    icon: IconSourceCode,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
];

/** Kibo used Fuse.js over these nine items; a substring match is enough (spec §6.1). */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return slashItems;
  return slashItems.filter(
    (item) => item.title.toLowerCase().includes(q) || item.searchTerms.some((t) => t.includes(q)),
  );
}
```

Run: `yarn test tests/unit/editor-markdown.test.ts tests/unit/editor-helpers.test.ts`
Expected: PASS. If a round-trip case fails only by trailing whitespace, fix `readMarkdown`, not the test. If the literal-HTML test fails after a Tiptap version change, the private method names in `LiteralHtmlMarkdown` moved — find them in `node_modules/@tiptap/markdown/dist/index.js` (`parseHTMLToken`, `htmlAsLiteralText`).

- [ ] **Step 5: Slash command and menu**

Create `src/components/kibo-ui/editor/slash.tsx`:

```tsx
'use client';

/**
 * Slash menu — adapted from Kibo UI's editor (haydenbleasel/kibo@3d63cdb, packages/editor):
 * a plain Extension + Suggestion instead of Kibo's inline "slash" Node (that node has no
 * Markdown form and is never kept in the document anyway); cmdk directly with Align styling
 * instead of shadcn's Command wrapper; arrow/enter navigation forwarded once (Kibo forwarded
 * from both editorProps and the suggestion, which moved the highlight twice).
 */

import { type Editor, Extension, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import { Command } from 'cmdk';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { filterSlashItems, type SlashItem } from '@/components/kibo-ui/editor/slash-items';

type SlashMenuProps = { items: SlashItem[]; editor: Editor; range: Range };

function SlashMenu({ items, editor, range }: SlashMenuProps) {
  return (
    <Command
      id="slash-command"
      label="Insert block"
      shouldFilter={false}
      onKeyDown={(event) => event.stopPropagation()}
      className="w-72 overflow-hidden rounded-2xl bg-bg-white-0 p-2 shadow-regular-md ring-1 ring-inset ring-stroke-soft-200"
    >
      <Command.List>
        <Command.Empty className="p-3 text-paragraph-sm text-text-sub-600">No results</Command.Empty>
        {items.map((item) => (
          <Command.Item
            key={item.title}
            value={item.title}
            onSelect={() => item.command({ editor, range })}
            className="flex cursor-pointer items-center gap-3 rounded-lg p-2 data-[selected=true]:bg-bg-weak-50"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg-white-0 ring-1 ring-inset ring-stroke-soft-200">
              <item.icon className="size-4 text-text-sub-600" aria-hidden="true" />
            </span>
            <span className="flex flex-col">
              <span className="text-label-sm text-text-strong-950">{item.title}</span>
              <span className="text-paragraph-xs text-text-sub-600">{item.description}</span>
            </span>
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}

/** cmdk owns arrow/enter handling; the editor keeps focus, so forward the keys to it. */
function forwardToMenu(event: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return false;
  const menu = document.querySelector('#slash-command');
  if (!menu) return false;
  event.preventDefault();
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, cancelable: true, bubbles: true }));
  return true;
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        pluginKey: new PluginKey('slashCommand'),
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.command({ editor, range }),
        render: () => {
          let component: ReactRenderer<unknown, SlashMenuProps> | undefined;
          let popup: TippyInstance | undefined;

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              popup = tippy(document.body, {
                getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
            },
            onUpdate: (props) => {
              component?.updateProps(props);
              popup?.setProps({
                getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
              });
            },
            onKeyDown: ({ event }) => {
              if (event.key === 'Escape') {
                popup?.hide();
                return true;
              }
              return forwardToMenu(event);
            },
            onExit: () => {
              popup?.destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
```

- [ ] **Step 6: Provider, bubble menu and controls**

Create `src/components/kibo-ui/editor/index.tsx`:

```tsx
'use client';

/**
 * Editor — trimmed from Kibo UI (haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263,
 * packages/editor/index.tsx). Kept: EditorProvider, EditorBubbleMenu, bold/italic/strike/code
 * buttons, link editing, placeholder, slash menu. Adapted:
 * - Tabler icons and Align CompactButton instead of lucide and shadcn Button/Tooltip.
 * - Buttons read active state with useEditorState, so they update on every selection change.
 * - Link editing happens inline inside the bubble menu. Kibo used a portaled Popover; focus
 *   leaving the menu element makes Tiptap hide the bubble menu, taking the popover with it.
 * - Links are limited to http(s)/mailto (normalizeLinkUrl).
 * - Removed: floating menu, node selector (the slash menu and Markdown shortcuts cover block
 *   types), tables, sub/superscript, underline, clear formatting, character count.
 */

import {
  IconBold, IconCheck, IconCode, IconItalic, IconLink, IconStrikethrough, IconUnlink,
  type TablerIcon,
} from '@tabler/icons-react';
import type { AnyExtension, Editor } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import {
  EditorProvider as TiptapEditorProvider,
  type EditorProviderProps as TiptapEditorProviderProps,
  useCurrentEditor,
  useEditorState,
} from '@tiptap/react';
import { BubbleMenu, type BubbleMenuProps } from '@tiptap/react/menus';
import { useMemo, useState } from 'react';
import * as CompactButton from '@/components/ui/compact-button';
import { markdownExtensions } from '@/components/kibo-ui/editor/extensions';
import { normalizeLinkUrl } from '@/components/kibo-ui/editor/link';
import { SlashCommand } from '@/components/kibo-ui/editor/slash';
import { cn } from '@/utils/cn';

export { loadMarkdown, readMarkdown } from '@/components/kibo-ui/editor/extensions';

export type EditorProviderProps = Omit<TiptapEditorProviderProps, 'extensions'> & {
  className?: string;
  placeholder?: string;
  extensions?: AnyExtension[];
};

export function EditorProvider({ className, placeholder, extensions, ...props }: EditorProviderProps) {
  // Stable across renders, so the editor is not rebuilt on every parent render.
  const allExtensions = useMemo(
    () => [
      ...markdownExtensions(),
      Placeholder.configure({
        placeholder,
        emptyEditorClass:
          'before:pointer-events-none before:float-left before:h-0 before:text-text-soft-400 before:content-[attr(data-placeholder)]',
      }),
      SlashCommand,
      ...(extensions ?? []),
    ],
    [placeholder, extensions],
  );

  return (
    <div className={cn(className, '[&_.ProseMirror-focused]:outline-none')}>
      <TiptapEditorProvider extensions={allExtensions} immediatelyRender={false} {...props} />
    </div>
  );
}

export function EditorBubbleMenu({ className, children, ...props }: Omit<BubbleMenuProps, 'editor'>) {
  const { editor } = useCurrentEditor();
  if (!editor) return null;
  return (
    <BubbleMenu
      editor={editor}
      className={cn(
        'flex items-center gap-0.5 rounded-10 bg-bg-white-0 p-1 shadow-regular-md ring-1 ring-inset ring-stroke-soft-200',
        className,
      )}
      {...props}
    >
      {children}
    </BubbleMenu>
  );
}

function FormatButton({
  label,
  icon,
  isActive,
  run,
}: {
  label: string;
  icon: TablerIcon;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}) {
  const { editor } = useCurrentEditor();
  const active = useEditorState({
    editor,
    selector: (ctx) => (ctx.editor ? isActive(ctx.editor) : false),
  });
  if (!editor) return null;

  return (
    <CompactButton.Root
      type="button"
      variant="ghost"
      size="medium"
      aria-label={label}
      aria-pressed={active}
      onClick={() => run(editor)}
      className={cn(active && 'bg-bg-weak-50 text-text-strong-950')}
    >
      <CompactButton.Icon as={icon} />
    </CompactButton.Root>
  );
}

export const EditorFormatBold = () => (
  <FormatButton label="Bold" icon={IconBold} isActive={(e) => e.isActive('bold')} run={(e) => e.chain().focus().toggleBold().run()} />
);
export const EditorFormatItalic = () => (
  <FormatButton label="Italic" icon={IconItalic} isActive={(e) => e.isActive('italic')} run={(e) => e.chain().focus().toggleItalic().run()} />
);
export const EditorFormatStrike = () => (
  <FormatButton label="Strikethrough" icon={IconStrikethrough} isActive={(e) => e.isActive('strike')} run={(e) => e.chain().focus().toggleStrike().run()} />
);
export const EditorFormatCode = () => (
  <FormatButton label="Inline code" icon={IconCode} isActive={(e) => e.isActive('code')} run={(e) => e.chain().focus().toggleCode().run()} />
);

export function EditorLinkControl() {
  const { editor } = useCurrentEditor();
  const active = useEditorState({
    editor,
    selector: (ctx) => ctx.editor?.isActive('link') ?? false,
  });
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);
  if (!editor) return null;

  if (!editing) {
    return (
      <CompactButton.Root
        type="button"
        variant="ghost"
        size="medium"
        aria-label="Link"
        aria-pressed={active}
        onClick={() => {
          setUrl((editor.getAttributes('link').href as string | undefined) ?? '');
          setInvalid(false);
          setEditing(true);
        }}
        className={cn(active && 'bg-bg-weak-50 text-primary-base')}
      >
        <CompactButton.Icon as={IconLink} />
      </CompactButton.Root>
    );
  }

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const href = normalizeLinkUrl(url);
    if (!href) {
      setInvalid(true);
      return;
    }
    editor!.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setEditing(false);
  }

  return (
    <form onSubmit={apply} className="flex items-center gap-1">
      <input
        autoFocus
        aria-label="Link URL"
        aria-invalid={invalid || undefined}
        value={url}
        onChange={(event) => { setUrl(event.target.value); setInvalid(false); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
            editor.commands.focus();
          }
        }}
        placeholder="Paste a link"
        className={cn(
          'h-8 w-48 rounded-lg bg-bg-weak-50 px-2 text-paragraph-sm text-text-strong-950 placeholder:text-text-soft-400',
          invalid && 'ring-1 ring-inset ring-error-base',
        )}
      />
      <CompactButton.Root type="submit" variant="ghost" size="medium" aria-label="Apply link">
        <CompactButton.Icon as={IconCheck} />
      </CompactButton.Root>
      {active && (
        <CompactButton.Root
          type="button"
          variant="ghost"
          size="medium"
          aria-label="Remove link"
          onClick={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            setEditing(false);
          }}
        >
          <CompactButton.Icon as={IconUnlink} />
        </CompactButton.Root>
      )}
    </form>
  );
}
```

- [ ] **Step 7: `RichTextField`**

Create `src/components/task/RichTextField.tsx`:

```tsx
'use client';

import { useRef } from 'react';
import {
  EditorBubbleMenu, EditorFormatBold, EditorFormatCode, EditorFormatItalic,
  EditorFormatStrike, EditorLinkControl, EditorProvider, loadMarkdown, readMarkdown,
} from '@/components/kibo-ui/editor';
import { cn } from '@/utils/cn';

type RichTextFieldProps = {
  /** Markdown shown at mount. Read once; remount with `key` to reset. */
  value: string;
  /** Accessible name (aria-label). Use this or `labelledBy`. */
  label?: string;
  /** Id of a visible element naming the field (aria-labelledby). */
  labelledBy?: string;
  placeholder?: string;
  onChange?: (markdown: string) => void;
  /** On blur, only when the Markdown differs from what was loaded or last committed. */
  onCommit?: (markdown: string) => void;
  className?: string;
};

export function RichTextField({
  value, label, labelledBy, placeholder, onChange, onCommit, className,
}: RichTextFieldProps) {
  // Loading normalises Markdown (a single newline becomes a hard break), so "changed" is
  // judged against what the editor produced on load, never against the stored string —
  // otherwise opening an old task and tabbing away would rewrite its description.
  const baseline = useRef<string | null>(null);

  return (
    <EditorProvider
      placeholder={placeholder}
      className={cn(
        'rounded-10 bg-bg-white-0 px-3 py-2 ring-1 ring-inset ring-stroke-soft-200 transition-shadow duration-150 focus-within:ring-stroke-strong-950',
        className,
      )}
      editorProps={{
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          ...(label ? { 'aria-label': label } : {}),
          ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
          class: 'md-content min-h-20 outline-none',
        },
      }}
      onCreate={({ editor }) => {
        loadMarkdown(editor, value);
        baseline.current = readMarkdown(editor);
      }}
      onUpdate={({ editor }) => onChange?.(readMarkdown(editor))}
      onBlur={({ editor }) => {
        const markdown = readMarkdown(editor);
        if (markdown === baseline.current) return;
        baseline.current = markdown;
        onCommit?.(markdown);
      }}
    >
      <EditorBubbleMenu>
        <EditorFormatBold />
        <EditorFormatItalic />
        <EditorFormatStrike />
        <EditorFormatCode />
        <EditorLinkControl />
      </EditorBubbleMenu>
    </EditorProvider>
  );
}
```

- [ ] **Step 8: Gate and commit**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`
Expected: all pass. (Nothing renders `RichTextField` yet; Tasks 4 and 5 wire it in.)

If typecheck rejects `Suggestion<SlashItem, SlashItem>` or `ReactRenderer<unknown, SlashMenuProps>`, read the generics in `node_modules/@tiptap/suggestion/dist/index.d.ts` and `node_modules/@tiptap/react/dist/index.d.ts` and adjust the type arguments only.

```bash
git add package.json yarn.lock src/components/kibo-ui/editor src/components/task/RichTextField.tsx tests/unit/editor-markdown.test.ts tests/unit/editor-helpers.test.ts
git commit -m "feat(ui): trimmed Kibo editor with lossless Markdown I/O"
```

---

### Task 4: Task detail dialog on Align, with the description editor

**Files (full rewrites):**
- `src/components/task/TaskDetailDialog.tsx`
- `src/components/task/LabelPicker.tsx`
- `src/components/task/SubtaskSection.tsx`

**Interfaces:**
- Consumes: `Modal`, `Select`, `Label`, `Button`, `Dropdown`, `Input` (Part 1); `TextField` (Part 1 Task 6); `RichTextField` (Task 3); `LabelChip` (Task 1).
- Produces: unchanged props for `TaskDetailDialog`, `LabelPicker`, `SubtaskSection`.

- [ ] **Step 1: Task detail dialog**

Replace `src/components/task/TaskDetailDialog.tsx`:

```tsx
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
```

- [ ] **Step 2: Label picker**

Replace `src/components/task/LabelPicker.tsx`:

```tsx
'use client';

import { IconCheck, IconTag, IconTrash } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { LabelChip } from '@/components/task/LabelChip';
import * as Dropdown from '@/components/ui/dropdown';
import * as Input from '@/components/ui/input';
import { createLabelAction, deleteLabelAction, setTaskLabelsAction } from '@/server/labels/actions';
import type { LabelRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

export function LabelPicker({
  workspaceSlug,
  taskId,
  allLabels,
  selected,
}: {
  workspaceSlug: string;
  taskId: string;
  allLabels: LabelRow[];
  selected: LabelRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState('');
  const selectedIds = new Set(selected.map((l) => l.id));

  function apply(labelIds: string[]) {
    startTransition(async () => {
      const result = await setTaskLabelsAction(workspaceSlug, { taskId, labelIds });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  function toggle(labelId: string) {
    const next = selectedIds.has(labelId)
      ? [...selectedIds].filter((id) => id !== labelId)
      : [...new Set([...selectedIds, labelId])];
    apply(next);
  }

  function onCreate(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const name = draft.trim();
    if (!name) return;

    startTransition(async () => {
      // Creating an existing name returns that label, so typing a duplicate
      // simply attaches it.
      const created = await createLabelAction(workspaceSlug, { name });
      if (!created.ok) {
        toast.error(created.error);
        return;
      }
      setDraft('');
      // A Set: typing the name of a label the task already carries returns that
      // same id, and sending it twice is not a selection change.
      apply([...new Set([...selectedIds, created.data.id])]);
    });
  }

  function onDelete(labelId: string) {
    startTransition(async () => {
      const result = await deleteLabelAction(workspaceSlug, { labelId });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-lg px-2 text-paragraph-sm text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950 data-[state=open]:bg-bg-weak-50">
        <IconTag className="size-4 shrink-0" aria-hidden="true" />
        {selected.length > 0
          ? <span className="flex flex-wrap gap-1">{selected.map((l) => <LabelChip key={l.id} name={l.name} />)}</span>
          : 'Add labels'}
      </Dropdown.Trigger>

      <Dropdown.Content align="start" className="w-64">
        <div className="p-1">
          <label htmlFor="new-label" className="sr-only">New label name</label>
          <Input.Root size="small">
            <Input.Wrapper>
              <Input.Input
                id="new-label"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(event) => {
                  // Radix menus treat printable keys as typeahead and move focus to a
                  // matching item; keep them in the field. Escape still closes the menu.
                  if (event.key !== 'Escape') event.stopPropagation();
                  onCreate(event);
                }}
                maxLength={32}
                placeholder="Type a name, press Enter"
              />
            </Input.Wrapper>
          </Input.Root>
        </div>

        {allLabels.length > 0 && <Dropdown.Separator />}

        {allLabels.map((label) => (
          <Dropdown.Item
            key={label.id}
            onSelect={(event) => { event.preventDefault(); toggle(label.id); }}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <IconCheck
                className={cn('size-4', selectedIds.has(label.id) ? 'opacity-100' : 'opacity-0')}
                aria-hidden="true"
              />
              {label.name}
            </span>
            <button
              type="button"
              aria-label={`Delete label ${label.name}`}
              onClick={(event) => { event.stopPropagation(); onDelete(label.id); }}
              className="rounded-md p-1 text-text-soft-400 transition-colors duration-150 hover:text-error-base"
            >
              <IconTrash className="size-4" aria-hidden="true" />
            </button>
          </Dropdown.Item>
        ))}
      </Dropdown.Content>
    </Dropdown.Root>
  );
}
```

- [ ] **Step 3: Subtasks**

Replace `src/components/task/SubtaskSection.tsx`:

```tsx
'use client';

import { IconCircle, IconCircleCheckFilled, IconPlus, IconTrash } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { doneToggleTarget } from '@/lib/task-done';
import type { StatusRow } from '@/server/projects/queries';
import { createTaskAction, deleteTaskAction, updateTaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

export function SubtaskSection({
  parent,
  subtasks,
  statuses,
  projectId,
  workspaceSlug,
}: {
  parent: TaskRow;
  subtasks: TaskRow[];
  statuses: StatusRow[];
  projectId: string;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);

  const doneCount = subtasks.filter((s) => s.completedAt !== null).length;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = inputRef.current?.value.trim();
    if (!title || pending) return;

    // Cleared up front so the field is ready for the next subtask, the same
    // bargain QuickAddTask makes.
    if (inputRef.current) inputRef.current.value = '';

    setPending(true);
    const result = await createTaskAction(workspaceSlug, {
      projectId,
      title,
      // Subtasks land in the parent's column, not the leftmost one: they are
      // part of work already in flight.
      statusId: parent.statusId,
      parentTaskId: parent.id,
    });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      if (inputRef.current && inputRef.current.value === '') inputRef.current.value = title;
      return;
    }

    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-label-sm text-text-strong-950">Subtasks</h2>
        <span className="tabular text-paragraph-xs text-text-sub-600">
          {doneCount}/{subtasks.length}
        </span>
      </div>

      {subtasks.length > 0 && (
        <ul className="overflow-hidden rounded-10 ring-1 ring-inset ring-stroke-soft-200">
          {subtasks.map((subtask) => (
            <SubtaskRow key={subtask.id} subtask={subtask} statuses={statuses} workspaceSlug={workspaceSlug} />
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="relative flex items-center gap-2 px-1">
        <IconPlus className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
        <label htmlFor={`add-subtask-${parent.id}`} className="sr-only">
          Add a subtask
        </label>
        <input
          id={`add-subtask-${parent.id}`}
          ref={inputRef}
          name="title"
          maxLength={200}
          aria-busy={pending}
          placeholder="Add a subtask…"
          className="h-11 w-full bg-transparent text-paragraph-md text-text-strong-950 placeholder:text-text-soft-400 lg:text-paragraph-sm"
        />
      </form>
    </section>
  );
}

function SubtaskRow({
  subtask,
  statuses,
  workspaceSlug,
}: {
  subtask: TaskRow;
  statuses: StatusRow[];
  workspaceSlug: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const done = subtask.completedAt !== null;

  function toggleDone() {
    const target = doneToggleTarget(statuses, done);
    if (!target) {
      toast.error('This project has no done column.');
      return;
    }
    startTransition(async () => {
      const result = await updateTaskAction(workspaceSlug, { taskId: subtask.id, statusId: target.id });
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  function open() {
    const next = new URLSearchParams(searchParams);
    next.set('task', subtask.id);
    // Same ?task= contract as the board, so a subtask is deep-linkable too.
    router.push(`?${next.toString()}`, { scroll: false });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteTaskAction(workspaceSlug, { taskId: subtask.id });
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  return (
    <li className="group flex items-center gap-2 border-b border-stroke-soft-200 pr-2 last:border-b-0">
      <button
        type="button"
        onClick={toggleDone}
        disabled={pending}
        aria-pressed={done}
        aria-label={done ? `Mark "${subtask.title}" as not done` : `Mark "${subtask.title}" as done`}
        className="inline-flex size-11 shrink-0 items-center justify-center text-text-soft-400 transition-colors duration-150 hover:text-text-strong-950 disabled:opacity-50"
      >
        {done
          ? <IconCircleCheckFilled className="size-4 text-success-base" aria-hidden="true" />
          : <IconCircle className="size-4" aria-hidden="true" />}
      </button>

      <button
        type="button"
        onClick={open}
        className={cn(
          'min-w-0 flex-1 truncate py-3 text-left text-paragraph-sm',
          done ? 'text-text-soft-400 line-through' : 'text-text-strong-950',
        )}
      >
        {subtask.title}
      </button>

      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={`Delete "${subtask.title}"`}
        // Always reachable by keyboard and on touch; only the hover styling is
        // conditional, so the row stays quiet until pointed at.
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-text-soft-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:text-error-base disabled:opacity-50"
      >
        <IconTrash className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}
```

- [ ] **Step 4: Gate**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass.

- [ ] **Step 5: e2e**

Run: `yarn e2e`
Expected: all pass — `board.spec.ts` covers `Title`, deep link, back, subtasks (`0/0`, `Add a subtask…`, `0/1`, the subtask button); `comments.spec.ts` covers `Priority` / `option "High"`.

- [ ] **Step 6: Check by hand**

Seed the case first: before Step 1 of this task the old textarea is still in place, so at that point run `yarn dev` and give one task the two-line description `line one` ⏎ `use <b>x</b> here`. Now, with the new dialog: open that task, click into the description, click out without typing — no toast, and the browser's network tab shows no server-action POST. The text still reads `use <b>x</b> here` literally. Type `**y**` at the end: it turns bold; click out: exactly one POST; reload: `y` renders bold and `<b>x</b>` is still literal.

- [ ] **Step 7: Commit**

```bash
git add src/components/task/TaskDetailDialog.tsx src/components/task/LabelPicker.tsx src/components/task/SubtaskSection.tsx
git commit -m "feat(ui): rebuild task dialog on Align with a Markdown description editor"
```

---

### Task 5: Comments — editor to write, Markdown to read

**Files:**
- Modify (full rewrite): `src/components/task/ActivityFeed.tsx`
- Modify: `tests/e2e/comments.spec.ts` (append one test — the only e2e change in the reset)

**Interfaces:**
- Consumes: `RichTextField` (Task 3), `Markdown` (Task 2), `Button`, `CompactButton`, `Avatar` (Part 1).
- Produces: unchanged `ActivityFeed` props.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/comments.spec.ts`:

```ts
test('a comment is written with the editor and rendered as Markdown', async ({ page }) => {
  await signUpWithTask(page, 'markdown');
  await page.getByRole('button', { name: 'Talk about me', exact: true }).click();

  // Typed key by key so the editor's **bold** input rule fires, as it does for a person.
  await page.getByLabel('Comment').pressSequentially('Ship **today**');
  await page.getByRole('button', { name: 'Comment' }).click();

  await expect(page.locator('strong', { hasText: 'today' })).toBeVisible();
  await page.reload();
  await expect(page.locator('strong', { hasText: 'today' })).toBeVisible();
});
```

Run: `yarn e2e tests/e2e/comments.spec.ts`
Expected: the new test FAILS (the comment box is still a textarea and the feed shows `**today**` literally); the existing test passes.

- [ ] **Step 2: Rewrite the feed**

Replace `src/components/task/ActivityFeed.tsx`:

```tsx
'use client';

import { IconTrash } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Markdown } from '@/components/task/Markdown';
import { RichTextField } from '@/components/task/RichTextField';
import * as Avatar from '@/components/ui/avatar';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import { describeActivity } from '@/lib/activity-text';
import { formatInZone } from '@/lib/dates';
import type { FeedEntry } from '@/server/activity/queries';
import {
  createCommentAction, deleteCommentAction, updateCommentAction,
} from '@/server/comments/actions';

export function ActivityFeed({
  taskId,
  feed,
  workspaceSlug,
  currentUserId,
  canModerate,
  timezone,
}: {
  taskId: string;
  feed: FeedEntry[];
  workspaceSlug: string;
  currentUserId: string;
  canModerate: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState('');
  // Bumped after a successful post: remounting the editor is how it is cleared.
  const [composerKey, setComposerKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft;
    if (!body.trim() || pending) return;

    startTransition(async () => {
      const result = await createCommentAction(workspaceSlug, { taskId, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft('');
      setComposerKey((k) => k + 1);
      router.refresh();
    });
  }

  function startEdit(entry: { id: string; body: string }) {
    setEditDraft(entry.body);
    setEditingId(entry.id);
  }

  function onEdit(commentId: string) {
    startTransition(async () => {
      const result = await updateCommentAction(workspaceSlug, { commentId, body: editDraft });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function onDelete(commentId: string) {
    if (!confirm('Delete this comment?')) return;
    startTransition(async () => {
      const result = await deleteCommentAction(workspaceSlug, { commentId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 border-t border-stroke-soft-200 pt-4">
      <h3 className="text-label-sm text-text-strong-950">Activity</h3>

      <ol className="flex flex-col gap-3">
        {feed.map((entry) =>
          entry.type === 'activity' ? (
            <li key={entry.id} className="text-paragraph-sm text-text-sub-600">
              <span className="text-label-sm text-text-strong-950">{entry.actorName}</span>{' '}
              {describeActivity(entry)}
              <span className="ml-2 text-paragraph-xs text-text-soft-400">
                {formatInZone(entry.createdAt, timezone)}
              </span>
            </li>
          ) : (
            <li key={entry.id} className="flex gap-3">
              <Avatar.Root size="24" color="blue" aria-hidden="true" className="mt-0.5 shrink-0">
                {entry.authorName.slice(0, 1)}
              </Avatar.Root>
              <div className="min-w-0 flex-1 rounded-10 bg-bg-weak-50 p-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-label-sm text-text-strong-950">{entry.authorName}</span>
                  <span className="text-paragraph-xs text-text-soft-400">
                    {formatInZone(entry.createdAt, timezone)}
                    {entry.editedAt && ' (edited)'}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {entry.authorId === currentUserId && editingId !== entry.id && (
                      <Button.Root type="button" variant="neutral" mode="ghost" size="xxsmall" onClick={() => startEdit(entry)}>
                        Edit
                      </Button.Root>
                    )}
                    {(entry.authorId === currentUserId || canModerate) && (
                      <CompactButton.Root
                        type="button"
                        variant="ghost"
                        size="medium"
                        aria-label={`Delete comment by ${entry.authorName}`}
                        onClick={() => onDelete(entry.id)}
                        className="hover:text-error-base"
                      >
                        <CompactButton.Icon as={IconTrash} />
                      </CompactButton.Root>
                    )}
                  </span>
                </div>

                {editingId === entry.id ? (
                  <form
                    onSubmit={(event) => { event.preventDefault(); onEdit(entry.id); }}
                    className="mt-2 flex flex-col gap-2"
                  >
                    <RichTextField value={entry.body} label="Edit comment" onChange={setEditDraft} />
                    <div className="flex gap-2">
                      <Button.Root type="submit" size="xxsmall" disabled={pending}>Save</Button.Root>
                      <Button.Root type="button" variant="neutral" mode="stroke" size="xxsmall" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button.Root>
                    </div>
                  </form>
                ) : (
                  <Markdown className="mt-1">{entry.body}</Markdown>
                )}
              </div>
            </li>
          ),
        )}
      </ol>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <RichTextField
          key={composerKey}
          value=""
          label="Comment"
          placeholder="Write a comment… Markdown and / commands work."
          onChange={setDraft}
        />
        <div>
          <Button.Root type="submit" size="small" disabled={pending}>
            Comment
          </Button.Root>
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 3: Run the e2e tests**

Run: `yarn e2e tests/e2e/comments.spec.ts`
Expected: both tests PASS. (`getByLabel('Comment').fill(...)` in the first test works on the editor's contenteditable; the posted comment renders through `<Markdown>`.)

- [ ] **Step 4: Full gate**

Run: `yarn typecheck && yarn lint && yarn test && yarn e2e`
Expected: all pass.

- [ ] **Step 5: Visual check**

Run `scripts/screenshots.mjs`; review `task-dialog-*` in both themes and widths: description editor, selects, labels, subtasks, feed, composer. By hand: type `/` in the comment box (menu opens; arrows move; Enter applies; Escape closes), select text (bubble menu; Link → paste `example.com` → Enter makes a link; `javascript:alert(1)` is refused with a red outline).

- [ ] **Step 6: Commit**

```bash
git add src/components/task/ActivityFeed.tsx tests/e2e/comments.spec.ts
git commit -m "feat(ui): Markdown comments with the Kibo editor"
```
