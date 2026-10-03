# Full-text search + ⌘K palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search tasks by title and description with Postgres full-text search, through a ⌘K command palette that replaces the header search box.

**Architecture:** A stored generated `tsvector` column on `task` (title weight A, description B) with a GIN index. `searchTasks` matches a sanitized prefix `to_tsquery` OR a title `ILIKE`, ranks with `ts_rank`, and returns a `ts_headline` snippet for description-only hits. A `cmdk` palette in the existing Radix `Modal` shows recent tasks, projects, task hits and navigation actions; `AppHeader` owns the create-task dialog's open state so the palette can open it.

**Tech Stack:** Next.js 16 (App Router, server actions), drizzle-orm 0.45 / drizzle-kit 0.31 on Postgres, cmdk 1.1.1, Radix dialog via `@/components/ui/modal`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-search-palette-design.md`

## Global Constraints

- Text search config is `'english'` everywhere (vector, query, headline).
- Every query filters `task.workspace_id = ctx.workspaceId` in the same `WHERE`; never post-filter.
- The tsquery string is always a bound parameter; never interpolated into SQL text.
- `toPrefixQuery`: split on `/[^\p{L}\p{N}]+/u`, lowercase, max 8 tokens, join `tok:*` with ` & `, `null` when empty.
- Search min length 2 chars, max 100 chars (unchanged). Debounce 200 ms. Task limit 10, project limit 3, recent limit 5.
- Snippet markers `«` / `»`; `ts_headline` options `StartSel=«,StopSel=»,MaxWords=18,MinWords=6,MaxFragments=1`. Rendered as text + `<mark>`, never `dangerouslySetInnerHTML`.
- Status copy exact: "Keep typing…", "Searching…", "No matches."
- Commits: plain messages, **no `Co-Authored-By` trailer**. Never push. Never change versions.
- Next.js here has breaking changes — check `node_modules/next/dist/docs/` before using any Next API not already used in the files you touch.

## Review Focus

1. **All-stopword or punctuation-only input** (`the`, `&|!:*()`) — must not throw; falls back to title `ILIKE` (or `[]`). Pinned in Task 1.
2. **⌘K while another dialog is open, or while the palette's own input has focus** — does nothing over the create/detail dialog; closes the palette when it is the open dialog. Pinned in Task 3 e2e.
3. **Stale responses while typing fast** — an older term's results never render under a newer term. Kept from `TaskSearch` via the `{ term, tasks }` guard in Task 3.
4. **Palette → "New task" focus handoff** — create dialog must open with focus inside it, not on `body`. Pinned in Task 3 e2e (title field focused/fillable).
5. **Description containing `«`/`»` or HTML** — rendered as text, no injection. Pinned in Task 2 unit test.

---

### Task 1: Search column and full-text `searchTasks`

**Files:**
- Create: `src/server/tasks/search-query.ts`
- Modify: `src/db/schema/task.ts` (imports, `task` table columns + indexes)
- Modify: `src/server/tasks/queries.ts:218-262` (`TaskSearchHit`, `searchTasks`)
- Modify: `src/server/tasks/actions.ts:8,95-106` (add `recentTasksAction`)
- Test: `tests/unit/search-query.test.ts` (create), `tests/server/tasks.test.ts:499-531` (extend `describe('searchTasks')`)

**Interfaces:**
- Produces: `toPrefixQuery(term: string): string | null`
- Produces: `TaskSearchHit = { id; title; projectId; projectName; projectColor; completed: boolean; snippet: string | null }`
- Produces: `searchTasks(ctx: WorkspaceContext, term: string, limit = 10): Promise<TaskSearchHit[]>`
- Produces: `recentTasksAction(workspaceSlug: string): Promise<Result<RecentTask[]>>` (5 items)

- [ ] **Step 1: Write failing unit test for `toPrefixQuery`**

`tests/unit/search-query.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toPrefixQuery } from '@/server/tasks/search-query';

describe('toPrefixQuery', () => {
  it('turns words into ANDed prefix terms, lowercased', () => {
    expect(toPrefixQuery('Deploy Pipe')).toBe('deploy:* & pipe:*');
  });

  it('strips tsquery operators and punctuation', () => {
    expect(toPrefixQuery("a&b | !c:* (d) 'e'")).toBe('a:* & b:* & c:* & d:* & e:*');
  });

  it('returns null when nothing searchable remains', () => {
    expect(toPrefixQuery('&|!:*()')).toBeNull();
    expect(toPrefixQuery('   ')).toBeNull();
  });

  it('keeps Unicode letters and digits', () => {
    expect(toPrefixQuery('Ереван v2')).toBe('ереван:* & v2:*');
  });

  it('caps the number of terms at 8', () => {
    expect(toPrefixQuery('a b c d e f g h i j').split(' & ')).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found)

Run: `yarn vitest run tests/unit/search-query.test.ts`

- [ ] **Step 3: Implement `src/server/tasks/search-query.ts`**

```ts
const MAX_TERMS = 8;

/**
 * Builds a prefix tsquery from what the person typed, so "deplo" already finds
 * "Deployment". Only letters and digits survive, so the result cannot carry
 * tsquery operators; it is still always passed as a bound parameter. Null when
 * nothing searchable is left.
 */
export function toPrefixQuery(term: string): string | null {
  const tokens = term
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_TERMS);
  return tokens.length ? tokens.map((t) => `${t}:*`).join(' & ') : null;
}
```

- [ ] **Step 4: Run unit test, expect PASS**

Run: `yarn vitest run tests/unit/search-query.test.ts`

- [ ] **Step 5: Add the column and index to the schema**

`src/db/schema/task.ts` — add `customType` to the `drizzle-orm/pg-core` import list, add `import { sql } from 'drizzle-orm';`, and above `export const task`:

```ts
const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});
```

Inside the `task` columns, after `updatedAt`:

```ts
    // Full-text search over title (weight A) and description (weight B).
    // Postgres fills it; app code never writes it.
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', description), 'B')`,
    ),
```

In the index list, add:

```ts
    index('task_search_idx').using('gin', t.search),
```

- [ ] **Step 6: Push to the test database and check it**

Run: `yarn db:setup:test`
Expected: push succeeds, no prompt about data loss.

Then run `yarn db:setup:test` **again**. Expected: no changes reported. If drizzle-kit fails to create the generated column, or reports a diff on every push, remove the `search` column + index from the schema, and instead create `src/db/sql/task-search.sql`:

```sql
-- Full-text search over task title (A) and description (B). Rerunnable.
ALTER TABLE task ADD COLUMN IF NOT EXISTS search tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', description), 'B')
  ) STORED;
CREATE INDEX IF NOT EXISTS task_search_idx ON task USING gin (search);
```

and reference it in queries via `sql\`${task}.search\`` (alias `const taskSearch = sql\`task.search\``) instead of `task.search`. Note which path you took in the commit message.

- [ ] **Step 7: Write failing server tests**

In `tests/server/tasks.test.ts`, inside `describe('searchTasks', …)` after the existing three cases (keep them — they must still pass):

```ts
  it('finds a word that only appears in the description, with a snippet', async () => {
    const { ctx, projectId } = await setup('s5@example.com', 'search-e');
    await createTask(ctx, {
      projectId,
      title: 'Release checklist',
      description: 'Before shipping, run the staging migration and smoke tests.',
    });

    const [hit] = await searchTasks(ctx, 'migration');

    expect(hit.title).toBe('Release checklist');
    expect(hit.snippet).toContain('«migration»');
  });

  it('matches word prefixes while typing', async () => {
    const { ctx, projectId } = await setup('s6@example.com', 'search-f');
    await createTask(ctx, { projectId, title: 'Deployment notes' });

    expect((await searchTasks(ctx, 'deplo')).map((h) => h.title)).toEqual(['Deployment notes']);
  });

  it('has no snippet when the title matched', async () => {
    const { ctx, projectId } = await setup('s7@example.com', 'search-g');
    await createTask(ctx, { projectId, title: 'Billing page', description: 'Billing copy update' });

    const [hit] = await searchTasks(ctx, 'billing');

    expect(hit.snippet).toBeNull();
  });

  it('ranks a title match above a description-only match', async () => {
    const { ctx, projectId } = await setup('s8@example.com', 'search-h');
    await createTask(ctx, { projectId, title: 'Misc', description: 'Mentions invoice once' });
    await createTask(ctx, { projectId, title: 'Invoice export' });

    expect((await searchTasks(ctx, 'invoice')).map((h) => h.title)).toEqual(['Invoice export', 'Misc']);
  });

  it('skips archived tasks and tasks in archived projects', async () => {
    const { ctx, projectId } = await setup('s9@example.com', 'search-i');
    const gone = await createTask(ctx, { projectId, title: 'Shelved widget' });
    const other = await createProject(ctx, { name: 'Old' });
    if (!gone.ok || !other.ok) throw new Error('setup failed');
    await createTask(ctx, { projectId: other.data.id, title: 'Old widget' });
    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, gone.data.id));
    await archiveProject(ctx, { projectId: other.data.id });

    expect(await searchTasks(ctx, 'widget')).toEqual([]);
  });

  it('never returns another workspace’s description match', async () => {
    const a = await setup('s10@example.com', 'search-j');
    const b = await setup('s11@example.com', 'search-k');
    await createTask(b.ctx, { projectId: b.projectId, title: 'Plan', description: 'confidential acquisition' });
    await createTask(a.ctx, { projectId: a.projectId, title: 'Plan', description: 'public notes' });

    expect(await searchTasks(a.ctx, 'acquisition')).toEqual([]);
  });

  it('survives operator-only and stop-word-only input', async () => {
    const { ctx, projectId } = await setup('s12@example.com', 'search-l');
    await createTask(ctx, { projectId, title: 'The plan' });

    expect(await searchTasks(ctx, '&|!:*()')).toEqual([]);
    // "the" is an English stop word, so FTS ignores it; the title ILIKE still finds it.
    expect((await searchTasks(ctx, 'the')).map((h) => h.title)).toEqual(['The plan']);
  });
```

- [ ] **Step 8: Run, expect the new cases to FAIL**

Run: `yarn vitest run tests/server/tasks.test.ts -t searchTasks`
Expected: description/prefix/snippet cases fail (title-only `ILIKE`; no `snippet` field).

- [ ] **Step 9: Rewrite `TaskSearchHit` and `searchTasks`**

`src/server/tasks/queries.ts` — add `import { toPrefixQuery } from './search-query';` and replace lines 218-262 with:

```ts
export type TaskSearchHit = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectColor: string;
  completed: boolean;
  /** Description excerpt with «matched» words, only when the title did not match. */
  snippet: string | null;
};

/**
 * Full-text search across the workspace for the command palette: word prefixes
 * in the title or description, plus a plain title substring so odd tokens
 * ("50%", "v2.1") still match. Best rank first, then open work, then recently
 * updated. The workspace filter sits in the same WHERE, so ranking never reads
 * another workspace's rows.
 */
export async function searchTasks(
  ctx: WorkspaceContext,
  term: string,
  limit = 10,
): Promise<TaskSearchHit[]> {
  const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const prefix = toPrefixQuery(term);
  const q = prefix ? sql`to_tsquery('english', ${prefix})` : null;

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      projectName: project.name,
      projectColor: project.color,
      completedAt: task.completedAt,
      snippet: q
        ? sql<string | null>`case
            when not (to_tsvector('english', ${task.title}) @@ ${q})
             and to_tsvector('english', ${task.description}) @@ ${q}
            then ts_headline('english', ${task.description}, ${q},
              'StartSel=«,StopSel=»,MaxWords=18,MinWords=6,MaxFragments=1')
          end`
        : sql<null>`null`,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .where(
      and(
        eq(task.workspaceId, ctx.workspaceId),
        isNull(task.archivedAt),
        isNull(project.archivedAt),
        q ? or(sql`${task.search} @@ ${q}`, ilike(task.title, pattern)) : ilike(task.title, pattern),
      ),
    )
    .orderBy(
      desc(q ? sql`ts_rank(${task.search}, ${q})` : sql`0`),
      sql`${task.completedAt} is not null`,
      desc(task.updatedAt),
    )
    .limit(limit);

  return rows.map(({ completedAt, ...r }) => ({ ...r, completed: completedAt !== null }));
}
```

Add `or` to the `drizzle-orm` import on line 1.

- [ ] **Step 10: Add `recentTasksAction`**

`src/server/tasks/actions.ts` — import `listRecentTasks, type RecentTask` alongside `searchTasks` on line 8, and after `searchTasksAction`:

```ts
/** Read-only. The palette's empty state: the caller's five latest touched tasks. */
export async function recentTasksAction(workspaceSlug: string): Promise<Result<RecentTask[]>> {
  return withAction(async () => {
    const ctx = await requireWorkspace(workspaceSlug);
    return ok(await listRecentTasks(ctx, 5));
  });
}
```

(`listRecentTasks` is already covered by its own tests; the action only adds the slug → ctx resolution every other action has.)

- [ ] **Step 11: Run server + unit tests, expect PASS**

Run: `yarn vitest run tests/server/tasks.test.ts tests/unit/search-query.test.ts && yarn typecheck`
Expected: all green, including the three pre-existing `searchTasks` cases.

- [ ] **Step 12: Commit**

```bash
git add src/db/schema/task.ts src/server/tasks/search-query.ts src/server/tasks/queries.ts src/server/tasks/actions.ts tests/unit/search-query.test.ts tests/server/tasks.test.ts
git commit -m "feat(search): full-text task search over title and description"
```

(Add `src/db/sql/task-search.sql` if Step 6 fell back to it.)

---

### Task 2: Pure palette helpers

**Files:**
- Create: `src/lib/highlights.ts`
- Create: `src/components/shell/palette-actions.ts`
- Test: `tests/unit/highlights.test.ts`, `tests/unit/palette-actions.test.ts`

**Interfaces:**
- Produces: `splitHighlights(snippet: string): { text: string; mark: boolean }[]`
- Produces: `type PaletteAction = { id: string; label: string; href?: string; command?: 'new-task' }`
- Produces: `paletteActions(workspaceSlug: string, pathname: string, projectName?: string): PaletteAction[]`
- Produces: `matchActions(actions: PaletteAction[], term: string): PaletteAction[]`

- [ ] **Step 1: Write failing tests**

`tests/unit/highlights.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { splitHighlights } from '@/lib/highlights';

describe('splitHighlights', () => {
  it('splits marked words from plain text', () => {
    expect(splitHighlights('run the «migration» then «smoke» tests')).toEqual([
      { text: 'run the ', mark: false },
      { text: 'migration', mark: true },
      { text: ' then ', mark: false },
      { text: 'smoke', mark: true },
      { text: ' tests', mark: false },
    ]);
  });

  it('keeps HTML as plain text', () => {
    expect(splitHighlights('<b>«x»</b>')).toEqual([
      { text: '<b>', mark: false },
      { text: 'x', mark: true },
      { text: '</b>', mark: false },
    ]);
  });

  it('tolerates an unclosed marker', () => {
    expect(splitHighlights('a «b')).toEqual([
      { text: 'a ', mark: false },
      { text: 'b', mark: true },
    ]);
  });
});
```

`tests/unit/palette-actions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchActions, paletteActions } from '@/components/shell/palette-actions';

describe('paletteActions', () => {
  it('lists the workspace actions', () => {
    expect(paletteActions('acme', '/acme').map((a) => a.label)).toEqual([
      'New task', 'My To-do', 'Recent', 'Starred', 'Workspace settings', 'Account preferences',
    ]);
  });

  it('adds the current project views on a project page', () => {
    const actions = paletteActions('acme', '/acme/projects/p1/board', 'Website');
    expect(actions.slice(-3)).toEqual([
      { id: 'view-board', label: 'Website: Board', href: '/acme/projects/p1/board' },
      { id: 'view-list', label: 'Website: List', href: '/acme/projects/p1/list' },
      { id: 'view-summary', label: 'Website: Summary', href: '/acme/projects/p1/summary' },
    ]);
  });

  it('points at the right routes', () => {
    const byId = Object.fromEntries(paletteActions('acme', '/acme').map((a) => [a.id, a]));
    expect(byId['new-task']).toEqual({ id: 'new-task', label: 'New task', command: 'new-task' });
    expect(byId.todo.href).toBe('/acme/todo');
    expect(byId['workspace-settings'].href).toBe('/acme/settings/general');
    expect(byId.preferences.href).toBe('/settings/preferences');
  });
});

describe('matchActions', () => {
  it('filters labels case-insensitively', () => {
    const actions = paletteActions('acme', '/acme');
    expect(matchActions(actions, 'SETT').map((a) => a.id)).toEqual(['workspace-settings']);
    expect(matchActions(actions, '  ')).toEqual(actions);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (modules missing)

Run: `yarn vitest run tests/unit/highlights.test.ts tests/unit/palette-actions.test.ts`

- [ ] **Step 3: Implement `src/lib/highlights.ts`**

```ts
export type HighlightPart = { text: string; mark: boolean };

/**
 * Splits a search snippet marked «like this» into parts to render as text and
 * <mark>. Everything stays text, so nothing in a description is ever parsed as
 * HTML.
 */
export function splitHighlights(snippet: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let mark = false;
  for (const chunk of snippet.split(/([«»])/)) {
    if (chunk === '«') mark = true;
    else if (chunk === '»') mark = false;
    else if (chunk) parts.push({ text: chunk, mark });
  }
  return parts;
}
```

- [ ] **Step 4: Implement `src/components/shell/palette-actions.ts`**

```ts
export type PaletteAction = { id: string; label: string; href?: string; command?: 'new-task' };

const PROJECT_PATH = /^\/[^/]+\/projects\/([^/]+)/;

/**
 * What the palette can do besides search. On a project page the project's
 * views join the list, named after the project so they read on their own.
 */
export function paletteActions(workspaceSlug: string, pathname: string, projectName?: string): PaletteAction[] {
  const base = `/${workspaceSlug}`;
  const actions: PaletteAction[] = [
    { id: 'new-task', label: 'New task', command: 'new-task' },
    { id: 'todo', label: 'My To-do', href: `${base}/todo` },
    { id: 'recent', label: 'Recent', href: `${base}/recent` },
    { id: 'starred', label: 'Starred', href: `${base}/starred` },
    { id: 'workspace-settings', label: 'Workspace settings', href: `${base}/settings/general` },
    { id: 'preferences', label: 'Account preferences', href: '/settings/preferences' },
  ];

  const projectId = PROJECT_PATH.exec(pathname)?.[1];
  if (projectId && projectName) {
    for (const view of ['board', 'list', 'summary'] as const) {
      actions.push({
        id: `view-${view}`,
        label: `${projectName}: ${view[0].toUpperCase()}${view.slice(1)}`,
        href: `${base}/projects/${projectId}/${view}`,
      });
    }
  }
  return actions;
}

export function matchActions(actions: PaletteAction[], term: string): PaletteAction[] {
  const needle = term.trim().toLowerCase();
  return needle ? actions.filter((a) => a.label.toLowerCase().includes(needle)) : actions;
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `yarn vitest run tests/unit/highlights.test.ts tests/unit/palette-actions.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/highlights.ts src/components/shell/palette-actions.ts tests/unit/highlights.test.ts tests/unit/palette-actions.test.ts
git commit -m "feat(search): snippet highlight parser and palette action list"
```

---

### Task 3: Command palette replaces header search

**Files:**
- Create: `src/components/shell/CommandPalette.tsx`
- Create: `tests/e2e/search.spec.ts`
- Modify: `src/components/shell/AppHeader.tsx` (whole file)
- Modify: `src/components/shell/CreateTaskDialog.tsx:44-74` (controlled `open`)
- Delete: `src/components/shell/TaskSearch.tsx`

**Interfaces:**
- Consumes: `searchTasksAction`, `recentTasksAction`, `TaskSearchHit`, `RecentTask` (Task 1); `splitHighlights`, `paletteActions`, `matchActions`, `PaletteAction` (Task 2); `ignoreShortcut` (`src/components/shell/shortcuts.ts`); `projectDot` (`src/components/brand/tint`).
- Produces: `CommandPalette({ workspaceSlug, projects, onNewTask }: { workspaceSlug: string; projects: ProjectSummary[]; onNewTask: () => void })`
- Produces: `CreateTaskDialog` gains required props `open: boolean; onOpenChange: (open: boolean) => void`.

- [ ] **Step 1: Write the failing e2e spec**

`tests/e2e/search.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

async function signUpWithProject(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Search Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Search ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
}

async function createTaskWithDescription(page: Page, title: string, description: string) {
  await page.getByRole('button', { name: 'Create task' }).click();
  const create = page.getByRole('dialog', { name: 'New task' });
  await create.getByLabel('Title').fill(title);
  await create.getByRole('textbox', { name: 'Description' }).fill(description);
  const submit = create.getByRole('button', { name: 'Create task' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(create).toBeHidden();
}

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search' });

test('⌘K finds a task by a word prefix in its description', async ({ page }) => {
  await signUpWithProject(page, 'search-desc');
  await createTaskWithDescription(page, 'Release checklist', 'Run the staging migration first.');

  await page.keyboard.press('ControlOrMeta+k');
  await palette(page).getByRole('combobox').fill('migra');

  const hit = palette(page).getByRole('option', { name: /Release checklist/ });
  await expect(hit).toBeVisible();
  await expect(hit.locator('mark')).toHaveText('migration');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/tasks\//);
  await expect(palette(page)).toBeHidden();
});

test('the header button and "/" open the palette; ⌘K toggles it', async ({ page }) => {
  await signUpWithProject(page, 'search-open');

  await page.getByRole('button', { name: 'Search' }).click();
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();

  await page.keyboard.press('/');
  await expect(palette(page)).toBeVisible();
  // ⌘K again closes it.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toBeHidden();
});

test('⌘K does nothing while another dialog is open', async ({ page }) => {
  await signUpWithProject(page, 'search-over');
  await page.getByRole('button', { name: 'Create task' }).click();
  const create = page.getByRole('dialog', { name: 'New task' });
  await create.getByLabel('Title').focus();

  await page.keyboard.press('ControlOrMeta+k');

  await expect(palette(page)).toBeHidden();
  await expect(create).toBeVisible();
});

test('the New task action opens the create dialog with focus inside it', async ({ page }) => {
  await signUpWithProject(page, 'search-new');

  await page.keyboard.press('ControlOrMeta+k');
  await palette(page).getByRole('combobox').fill('new task');
  await palette(page).getByRole('option', { name: 'New task' }).click();

  const create = page.getByRole('dialog', { name: 'New task' });
  await expect(create).toBeVisible();
  await expect(palette(page)).toBeHidden();
  await create.getByLabel('Title').fill('From the palette');
  await expect(create.getByLabel('Title')).toHaveValue('From the palette');
});

test('an empty palette shows recent tasks and actions', async ({ page }) => {
  await signUpWithProject(page, 'search-empty');
  await createTaskWithDescription(page, 'Recently made', 'x');

  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page).getByRole('option', { name: /Recently made/ })).toBeVisible();
  await expect(palette(page).getByRole('option', { name: 'My To-do' })).toBeVisible();
});
```

- [ ] **Step 2: Check no other spec used the old header search**

Run: `grep -rn "Search tasks and projects\|getByPlaceholder('Search')" tests/e2e`
Expected: no matches (none at plan time). Update any that appear to open the palette instead.

- [ ] **Step 3: Make `CreateTaskDialog` controlled**

In `src/components/shell/CreateTaskDialog.tsx`, replace the signature through the end of the local `onOpenChange` function (lines 44-62) with:

```tsx
export function CreateTaskDialog({
  workspaceSlug,
  projects,
  open,
  onOpenChange,
}: {
  workspaceSlug: string;
  projects: ProjectSummary[];
  /** Owned by AppHeader so the command palette can open it too. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const params = useParams<{ projectId?: string }>();
  // Bumped per open, however it was opened (button, "c", or the palette), so
  // the form always starts blank.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((n) => n + 1);
  }
  const disabled = projects.length === 0;
```

The rest of the file is unchanged: the `c` shortcut keeps calling `onOpenChange(true)` and `<Modal.Root open={open} onOpenChange={onOpenChange}>` now uses the props.

- [ ] **Step 4: Write `src/components/shell/CommandPalette.tsx`**

```tsx
'use client';

import { IconArrowRight, IconCircleCheck, IconPlus, IconSearch } from '@tabler/icons-react';
import { Command } from 'cmdk';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { projectDot } from '@/components/brand/tint';
import { matchActions, paletteActions, type PaletteAction } from '@/components/shell/palette-actions';
import { ignoreShortcut } from '@/components/shell/shortcuts';
import * as Modal from '@/components/ui/modal';
import { splitHighlights } from '@/lib/highlights';
import { settle } from '@/lib/settle';
import type { ProjectSummary } from '@/server/projects/queries';
import type { RecentTask, TaskSearchHit } from '@/server/tasks/queries';
import { recentTasksAction, searchTasksAction } from '@/server/tasks/actions';
import { cn } from '@/utils/cn';

const itemClass =
  'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-label-sm text-text-strong-950 data-[selected=true]:bg-bg-weak-50';
const groupClass =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-label-xs [&_[cmdk-group-heading]]:text-text-soft-400';

type TaskLike = Pick<TaskSearchHit, 'id' | 'title' | 'projectName' | 'completed'> & { snippet?: string | null };

/**
 * ⌘K / Ctrl+K, "/" or the header button. Empty, it offers recent tasks and
 * actions; typed into, projects match locally, tasks come from full-text search
 * after a short pause, and actions filter by label.
 */
export function CommandPalette({
  workspaceSlug,
  projects,
  onNewTask,
}: {
  workspaceSlug: string;
  projects: ProjectSummary[];
  onNewTask: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [recent, setRecent] = useState<RecentTask[]>([]);
  // Results remember the term they answer, so a slow response for an older
  // term never shows under a newer one, and "loading" is simply a mismatch.
  const [found, setFound] = useState<{ term: string; tasks: TaskSearchHit[] }>({ term: '', tasks: [] });
  // Set when "New task" is picked; the create dialog opens once this one has
  // finished closing, so focus lands in it rather than on <body>.
  const pendingNewTask = useRef(false);
  const [isMac, setIsMac] = useState(false);

  const trimmed = term.trim();
  const searchable = trimmed.length >= 2;
  const tasks = searchable && found.term === trimmed ? found.tasks : [];
  const loading = searchable && found.term !== trimmed;

  useEffect(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const modK = e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
      if (modK) {
        // Another dialog or menu owns the screen; leave it alone.
        if (!open && document.querySelector('[role="dialog"], [role="menu"]')) return;
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === '/' && !open && !ignoreShortcut(e)) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    settle(recentTasksAction(workspaceSlug)).then((r) => {
      if (live) setRecent(r.ok ? r.data : []);
    });
    return () => { live = false; };
  }, [open, workspaceSlug]);

  useEffect(() => {
    if (!searchable) return;
    const timer = setTimeout(async () => {
      const result = await settle(searchTasksAction(workspaceSlug, trimmed));
      setFound({ term: trimmed, tasks: result.ok ? result.data : [] });
    }, 200);
    return () => clearTimeout(timer);
  }, [searchable, trimmed, workspaceSlug]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setTerm('');
  }

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  function run(action: PaletteAction) {
    if (action.command === 'new-task') {
      pendingNewTask.current = true;
      onOpenChange(false);
    } else if (action.href) {
      go(action.href);
    }
  }

  const projectName = projects.find((p) => pathname.includes(`/projects/${p.id}`))?.name;
  const actions = matchActions(paletteActions(workspaceSlug, pathname, projectName), trimmed);
  const needle = trimmed.toLowerCase();
  const projectHits = trimmed ? projects.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 3) : [];
  const taskRows: TaskLike[] = trimmed ? tasks : recent;
  const nothing = !projectHits.length && !taskRows.length && !actions.length;

  function taskItem(t: TaskLike) {
    return (
      <Command.Item
        key={`task-${t.id}`}
        value={`task-${t.id}`}
        onSelect={() => go(`/${workspaceSlug}/tasks/${t.id}`)}
        className={itemClass}
      >
        <IconCircleCheck
          aria-hidden="true"
          className={cn('size-4 shrink-0 self-start mt-0.5', t.completed ? 'text-success-base' : 'text-text-soft-400')}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate', t.completed && 'text-text-sub-600 line-through')}>{t.title}</span>
          {t.snippet && (
            <span className="truncate text-paragraph-xs text-text-sub-600">
              {splitHighlights(t.snippet).map((p, i) =>
                p.mark ? (
                  <mark key={i} className="rounded-sm bg-primary-alpha-16 text-text-strong-950">{p.text}</mark>
                ) : (
                  <span key={i}>{p.text}</span>
                ),
              )}
            </span>
          )}
        </span>
        <span className="ml-2 shrink-0 truncate text-paragraph-xs text-text-soft-400">{t.projectName}</span>
      </Command.Item>
    );
  }

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Trigger asChild>
        <button
          type="button"
          aria-label="Search"
          className="flex h-9 w-full max-w-md items-center gap-2 rounded-10 bg-bg-white-0 px-2.5 text-paragraph-sm text-text-soft-400 ring-1 ring-inset ring-stroke-soft-200 transition hover:bg-bg-weak-50 max-sm:w-9 max-sm:justify-center max-sm:px-0"
        >
          <IconSearch aria-hidden="true" className="size-5 shrink-0" />
          <span className="flex-1 text-left max-sm:sr-only">Search…</span>
          <kbd className="hidden rounded border border-stroke-soft-200 px-1.5 text-label-xs lg:inline">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
      </Modal.Trigger>
      <Modal.Content
        aria-describedby={undefined}
        showClose={false}
        overlayClassName="items-start pt-[12vh] max-sm:p-0"
        className="max-w-xl overflow-hidden p-0 max-sm:h-dvh max-sm:max-w-none max-sm:rounded-none"
        onCloseAutoFocus={(e) => {
          if (!pendingNewTask.current) return;
          pendingNewTask.current = false;
          e.preventDefault();
          onNewTask();
        }}
      >
        <Modal.Title className="sr-only">Search</Modal.Title>
        <Command label="Search" shouldFilter={false} loop>
          <div className="flex items-center gap-2 border-b border-stroke-soft-200 px-3">
            <IconSearch className="size-5 shrink-0 text-text-soft-400" aria-hidden="true" />
            <Command.Input
              value={term}
              onValueChange={setTerm}
              maxLength={100}
              placeholder="Search tasks, projects and actions"
              // 16px on phones stops iOS zooming the page when the field is focused.
              className="h-12 w-full bg-transparent text-paragraph-sm text-text-strong-950 outline-none placeholder:text-text-soft-400 max-lg:text-paragraph-md"
            />
          </div>
          <Command.List className="max-h-[min(26rem,70dvh)] overflow-y-auto p-1.5 max-sm:max-h-none">
            {trimmed && (!searchable || loading || nothing) && (
              <p className="px-2.5 py-3 text-paragraph-sm text-text-sub-600">
                {!searchable ? 'Keep typing…' : loading ? 'Searching…' : 'No matches.'}
              </p>
            )}
            {projectHits.length > 0 && (
              <Command.Group heading="Projects" className={groupClass}>
                {projectHits.map((p) => (
                  <Command.Item
                    key={`project-${p.id}`}
                    value={`project-${p.id}`}
                    onSelect={() => go(`/${workspaceSlug}/projects/${p.id}`)}
                    className={itemClass}
                  >
                    <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-[3px]', projectDot(p))} />
                    <span className="truncate">{p.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {taskRows.length > 0 && (
              <Command.Group heading={trimmed ? 'Tasks' : 'Recent'} className={groupClass}>
                {taskRows.map(taskItem)}
              </Command.Group>
            )}
            {actions.length > 0 && (
              <Command.Group heading="Actions" className={groupClass}>
                {actions.map((a) => (
                  <Command.Item key={a.id} value={`action-${a.id}`} onSelect={() => run(a)} className={itemClass}>
                    {a.command === 'new-task' ? (
                      <IconPlus aria-hidden="true" className="size-4 shrink-0 text-text-soft-400" />
                    ) : (
                      <IconArrowRight aria-hidden="true" className="size-4 shrink-0 text-text-soft-400" />
                    )}
                    <span className="truncate">{a.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </Modal.Content>
    </Modal.Root>
  );
}
```

Notes for the implementer:
- If `bg-primary-alpha-16`, `rounded-10` or `items-start` on the overlay are not in this project's tokens/overlay, grep `src/styles` and `src/components/ui/modal.tsx` and use the nearest existing class; do not add tokens.
- `ignoreShortcut` already returns true while any dialog is open, so "/" never fires over the create dialog.

- [ ] **Step 5: Rewrite `src/components/shell/AppHeader.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { CreateTaskDialog } from '@/components/shell/CreateTaskDialog';
import { MobileNav, type RailProps } from '@/components/shell/Rail';

/**
 * Top bar of the content column, on every workspace and account page. It owns
 * the mobile nav trigger, so pages no longer pad their left edge to clear a
 * floating button, and the create dialog's open state, which the command
 * palette's "New task" also drives.
 */
export function AppHeader(props: RailProps) {
  const [creating, setCreating] = useState(false);
  const canCreate = props.projects.length > 0;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-stroke-soft-200 bg-bg-white-0/85 px-3 backdrop-blur-md lg:gap-3 lg:px-6">
      <MobileNav {...props} />
      <div className="flex min-w-0 flex-1 justify-center max-sm:justify-end">
        <CommandPalette
          workspaceSlug={props.workspaceSlug}
          projects={props.projects}
          onNewTask={() => { if (canCreate) setCreating(true); }}
        />
      </div>
      <CreateTaskDialog
        workspaceSlug={props.workspaceSlug}
        projects={props.projects}
        open={creating}
        onOpenChange={setCreating}
      />
    </header>
  );
}
```

- [ ] **Step 6: Delete the old search**

Run: `git rm src/components/shell/TaskSearch.tsx && grep -rn "TaskSearch\b" src`
Expected: no remaining imports (`TaskSearchHit` type references are fine).

- [ ] **Step 7: Typecheck, lint, unit/server tests**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all green.

- [ ] **Step 8: Run e2e locally, expect PASS**

The user's `next dev` often holds :3000. Use a temp config on :3100:

```bash
sed -e 's#localhost:3000#localhost:3100#g' -e "s#yarn build \&\& yarn start#yarn build \&\& yarn start -p 3100#" \
  -e "s#TZ: 'UTC',#TZ: 'UTC', BETTER_AUTH_URL: 'http://localhost:3100',#" playwright.config.ts > /tmp/pw-3100.config.ts
cp /tmp/pw-3100.config.ts ./playwright.3100.config.ts
yarn playwright test -c playwright.3100.config.ts
rm playwright.3100.config.ts
```

(The test DB already has the column from Task 1 Step 6.) Expected: `search.spec.ts` 5 passed and every existing spec still passing. Do not commit the temp config.

- [ ] **Step 9: Commit**

```bash
git add src/components/shell/CommandPalette.tsx src/components/shell/AppHeader.tsx src/components/shell/CreateTaskDialog.tsx tests/e2e/search.spec.ts
git commit -m "feat(search): ⌘K command palette replaces the header search box"
```

(`TaskSearch.tsx` removal is already staged by `git rm`.)

- [ ] **Step 10: Refresh the knowledge graph**

Run: `graphify update .` (AST-only; per repo CLAUDE.md). Do not commit `graphify-out/` unless it is already tracked.

---

## After all tasks

PR description (base `develop`) must include: **run `yarn db:setup:prod` (and `yarn db:setup:dev`) BEFORE deploying** — without `task.search`, every search request errors. Do not push or open the PR without the user's go.
