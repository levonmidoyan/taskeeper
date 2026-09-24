# UI Reset — Part 1: Foundation, Align Primitives, Auth Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Align UI's tokens, utilities and base components into the app, move the shadcn components aside so every existing screen keeps working, and rebuild the auth screens on Align.

**Architecture:** Align's token CSS is generated once by `@alignui/cli` in a throwaway directory and committed as `src/styles/align-tokens.css`. Align component source is copied from the starter repo at a pinned commit into `src/components/ui/`, with Remix icons rewritten to Tabler and Tailwind v3 syntax rewritten to v4. The shadcn components move to `src/components/legacy-ui/` (deleted in Part 4); a token bridge in `globals.css` maps shadcn token names onto Align tokens so legacy screens still render.

**Tech Stack:** Next.js 16.3.5 (App Router), React 19.3, Tailwind CSS 4.3.3 (CSS-first), tailwind-variants 3.3.1, tailwind-merge 3.7.0, Radix primitives (scoped packages, via Align), `@tabler/icons-react` 3.48.0, Vitest 4, Playwright 1.58.

**Spec:** `docs/superpowers/specs/2026-09-24-ui-reset-design.md` (read §3, §4, §10 before starting).

**Plan series:** Part 1 (this) → `2026-09-24-ui-reset-part-2-shell-settings.md` → `2026-09-24-ui-reset-part-3-tasks-editor.md` → `2026-09-24-ui-reset-part-4-kanban-cleanup.md`. Each part leaves the app working with all tests green.

## Global Constraints

- Work on branch `feat/ui-reset`. Commit after every task. Commit messages: Conventional Commits, **no `Co-Authored-By` or any attribution trailer**.
- Do not change the `version` field in `package.json`.
- Pin every new dependency exactly: `yarn add -E <pkg>@<version>` (dev deps: `yarn add -E -D`).
- `AGENTS.md`: this Next.js has breaking changes; before writing Next-specific code (fonts, layouts, routing) read the matching guide under `node_modules/next/dist/docs/`.
- Icons come only from `@tabler/icons-react`. No new `lucide-react`, `@remixicon/react` imports anywhere.
- New app code uses Align token classes (`bg-bg-white-0`, `text-text-strong-950`, `text-label-sm`, `ring-stroke-soft-200`, …), never the bridged shadcn names (`bg-background`, `text-muted-foreground`, …) and never hex colours.
- Every accessible name and role listed in spec §4.1 is preserved exactly. The e2e specs in `tests/e2e/` are **not** edited in this part.
- Verification gate at the end of every task: `yarn typecheck && yarn lint && yarn test`. `yarn e2e` additionally at the end of Tasks 3 and 6 (needs `yarn db:up` first).

## Review Focus

- **OS in dark mode, user picks Light** → the app must be light. Align's generated CSS switches on `prefers-color-scheme` as well as `.dark`; the media block must be gone (Task 1 test pins this).
- **Theme variables referenced only from `.dark`** (`--color-neutral-*`) → must still be emitted, or dark mode renders unset colours. Tokens use `@theme static` (Task 1 test pins this).
- **`cn()` merging an Align font-size with an Align text colour** (`text-label-sm text-text-sub-600`) → both must survive; merging two font sizes keeps the last (Task 2 test pins this).
- **A vendored Radix component rendered from a Server Component** → must not crash with "use client" errors (Task 4 guard test pins the directive).
- **Keyboard focus on non-Align elements** (links, the quick-add input) → a visible focus ring must remain; the base-layer `:focus-visible` outline stays (Task 1 CSS; checked in Task 6 screenshots).

---

### Task 1: Align tokens, Inter font, and the new `globals.css`

**Files:**
- Create: `src/styles/align-tokens.css` (generated)
- Create: `src/app/fonts/InterVariable.woff2` (downloaded)
- Delete: `src/app/fonts/PlusJakartaSans-Variable.woff2`
- Modify: `src/app/globals.css` (full rewrite)
- Modify: `src/app/layout.tsx:1-35`
- Test: `tests/unit/align-tokens.test.ts`

**Interfaces:**
- Produces: CSS custom properties `--color-bg-*`, `--color-text-*`, `--color-stroke-*`, `--color-primary-*`, `--color-{error,success,warning,information,…}-*`, `--text-{title,label,paragraph,subheading}-*`, `--shadow-*`, `--radius-10`, `--radius-20`; `.dark` overrides; the bridge names `bg-background`, `text-muted-foreground`, etc.; CSS variable `--font-inter`; utility class `.tabular`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/align-tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/align-tokens.css', 'utf8');

describe('align-tokens.css', () => {
  it('lets next-themes alone decide dark mode', () => {
    // A prefers-color-scheme block would force dark colours on a dark-OS user who
    // picked Light in the theme switcher.
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).toMatch(/^\.dark \{/m);
  });

  it('emits every theme variable, including ones only .dark references', () => {
    expect(css).toMatch(/^@theme static \{/m);
    expect(css).toContain('--color-neutral-950');
  });

  it('carries the Align token families the components use', () => {
    for (const token of [
      '--color-bg-white-0', '--color-text-strong-950', '--color-stroke-soft-200',
      '--color-primary-base', '--text-label-sm', '--shadow-regular-xs', '--radius-10',
    ]) {
      expect(css).toContain(token);
    }
  });

  it('is a partial, not a standalone stylesheet', () => {
    // globals.css owns the tailwindcss import and the body rules.
    expect(css).not.toContain('@import');
    expect(css).not.toMatch(/^body \{/m);
    expect(css).not.toContain('.remixicon');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/unit/align-tokens.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open 'src/styles/align-tokens.css'`

- [ ] **Step 3: Generate the tokens in a throwaway project**

The CLI is interactive (clack prompts), requires a `tailwind.config` file, and installs `tailwindcss@latest` — so it never runs in this repo. The driver answers every prompt with its default (Blue, Gray, oklch, no prefix, no config file, `app/globals.css`), which are exactly the spec's choices (D2).

```bash
GEN=$(mktemp -d)
cd "$GEN"
printf '{"name":"align-gen","version":"0.0.0","dependencies":{"next":"16.3.5","react":"19.3.0"}}' > package.json
mkdir app && echo '@import "tailwindcss";' > app/globals.css && echo 'export default {}' > tailwind.config.ts
cat > drive.py <<'EOF'
import os, pty, select, time
pid, fd = pty.fork()
if pid == 0:
    os.execvp("npx", ["npx", "-y", "@alignui/cli@0.0.19", "tailwind"])
sent, last = 0, time.time()
while True:
    ready, _, _ = select.select([fd], [], [], 1.0)
    if ready:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        last = time.time()
    elif time.time() - last > 4 and sent < 8:
        os.write(fd, b"\r")  # accept the highlighted default
        sent, last = sent + 1, time.time()
    if time.time() - last > 240:
        break
EOF
timeout 400 python3 drive.py
wc -l app/globals.css   # expect ~1040 lines
cd /home/levon/taskeeper
```

- [ ] **Step 4: Post-process into `src/styles/align-tokens.css`**

```bash
mkdir -p src/styles
python3 - "$GEN/app/globals.css" src/styles/align-tokens.css <<'EOF'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
css = open(src).read()

def drop_block(text, header_regex):
    """Remove a top-level block whose header matches, braces balanced."""
    m = re.search(header_regex, text, re.M)
    if not m:
        raise SystemExit(f"block not found: {header_regex}")
    i = text.index('{', m.start())
    depth = 0
    for j in range(i, len(text)):
        if text[j] == '{': depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                return text[:m.start()] + text[j + 1:]
    raise SystemExit("unbalanced braces")

css = re.sub(r'^@import "tailwindcss";\n', '', css, flags=re.M)
css = re.sub(r'/\* Dark Mode Support - Tailwind v4\.1 CSS Variables \*/\n', '', css)
css = drop_block(css, r'^@media \(prefers-color-scheme: dark\)')
css = re.sub(r'/\* Custom styles \*/\n', '', css)
css = drop_block(css, r'^\.remixicon path')
css = re.sub(r'/\* AlignUI Body Styles \*/\n', '', css)
css = drop_block(css, r'^body \{')
css = re.sub(r'^@theme \{', '@theme static {', css, count=1, flags=re.M)
header = (
    "/*\n"
    " * Generated by `npx @alignui/cli@0.0.19 tailwind` (Blue / Gray / oklch / no prefix),\n"
    " * then post-processed: the OS dark-mode media block, the Remix icon rule and the body\n"
    " * rule were removed, and @theme became @theme static. Regenerate with the steps in\n"
    " * docs/superpowers/plans/2026-09-24-ui-reset-part-1-foundation.md (Task 1) — never edit\n"
    " * by hand.\n"
    " */\n"
)
open(dst, 'w').write(header + re.sub(r'\n{3,}', '\n\n', css).strip() + '\n')
EOF
rm -rf "$GEN"
```

- [ ] **Step 5: Download Inter and remove Plus Jakarta Sans**

```bash
curl -sfL -o src/app/fonts/InterVariable.woff2 \
  https://github.com/rsms/inter/raw/v4.1/docs/font-files/InterVariable.woff2
test "$(wc -c < src/app/fonts/InterVariable.woff2)" -gt 300000
git rm -q src/app/fonts/PlusJakartaSans-Variable.woff2
```

- [ ] **Step 6: Rewrite `src/app/globals.css`**

Replace the whole file with:

```css
@import "tailwindcss";
/* Animation utilities (animate-in, fade-in-0, zoom-in-95, slide-in-from-*) used by Align's
   Modal, Drawer, Dropdown, Select and Tooltip (spec §10 A1). */
@import "tw-animate-css";
/* LEGACY — radix-nova variants for src/components/legacy-ui/*. Removed in Part 4. */
@import "shadcn/tailwind.css";
@import "../styles/align-tokens.css";

@custom-variant dark (&:where(.dark, .dark *));

@theme inline {
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
}

/*
 * Bridge: shadcn token names → Align tokens (spec §3.3).
 * Kibo UI components (src/components/kibo-ui/*) are written against these names. Until
 * Part 4, the legacy components and not-yet-rebuilt screens use them too; Part 4 trims this
 * block to the names Kibo still uses. App code written from Part 1 on never uses them.
 */
@theme inline {
  --color-background: var(--color-bg-white-0);
  --color-foreground: var(--color-text-strong-950);
  --color-card: var(--color-bg-white-0);
  --color-card-foreground: var(--color-text-strong-950);
  --color-popover: var(--color-bg-white-0);
  --color-popover-foreground: var(--color-text-strong-950);
  --color-muted: var(--color-bg-weak-50);
  --color-muted-foreground: var(--color-text-sub-600);
  --color-secondary: var(--color-bg-weak-50);
  --color-secondary-foreground: var(--color-text-strong-950);
  --color-accent: var(--color-bg-weak-50);
  --color-accent-foreground: var(--color-text-strong-950);
  --color-border: var(--color-stroke-soft-200);
  --color-input: var(--color-stroke-soft-200);
  --color-ring: var(--color-primary-base);
  --color-primary: var(--color-primary-base);
  --color-primary-foreground: var(--color-static-white);
  --color-destructive: var(--color-error-base);
  --color-success: var(--color-success-base);
}

/* LEGACY — radii used as rounded-[var(--radius-*)] by not-yet-rebuilt screens. Part 4 removes. */
:root {
  --radius-button: 0.5rem;
  --radius-card: 0.625rem;
  --radius-panel: 1rem;
}

@layer base {
  /* Tailwind v4 defaults borders to currentColor; Align and Kibo expect a soft stroke. */
  *, ::before, ::after {
    border-color: var(--color-stroke-soft-200);
  }

  body {
    background-color: var(--color-bg-white-0);
    color: var(--color-text-strong-950);
    font-family: var(--font-sans);
    line-height: 1.5;
  }

  button:not(:disabled),
  [role="button"]:not([aria-disabled="true"]) {
    cursor: pointer;
  }

  /* Focus rings are never removed (v1 Global Constraints). In the base layer so Align
     controls, which draw their own focus shadow, can replace it with outline-none. */
  :focus-visible {
    outline: 2px solid var(--color-primary-base);
    outline-offset: 2px;
  }
}

/* Numeric columns must not jitter as values change (v1 spec §6.2). */
.tabular {
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 7: Switch the root layout to Inter**

In `src/app/layout.tsx`, replace the font block and the `<html>` class:

```tsx
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

// Self-hosted like the font it replaces (spec §10 A5): no build-time network fetch.
const inter = localFont({
  src: './fonts/InterVariable.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'Taskeeper',
  description: 'Task management for small teams',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          {/* aria-live, and never steals focus. */}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

(`@/components/ui/sonner` still exists here; Task 3 moves it, Task 5 replaces it.)

- [ ] **Step 8: Run the tests and the build**

Run: `yarn test tests/unit/align-tokens.test.ts`
Expected: PASS (4 tests)

Run: `yarn typecheck && yarn lint && yarn test && yarn build`
Expected: all pass; build completes.

- [ ] **Step 9: Commit**

```bash
git add src/styles/align-tokens.css src/app/globals.css src/app/layout.tsx src/app/fonts tests/unit/align-tokens.test.ts
git commit -m "feat(ui): Align design tokens, Inter font, and shadcn token bridge"
```

---

### Task 2: Align utilities (`cn`, `tv`, polymorphic, recursive clone)

**Files:**
- Create: `src/utils/align-tokens.ts`, `src/utils/cn.ts`, `src/utils/tv.ts`
- Create (vendored verbatim): `src/utils/polymorphic.ts`, `src/utils/recursive-clone-children.tsx`
- Create: `src/global.d.ts`
- Test: `tests/unit/cn.test.ts`

**Interfaces:**
- Produces: `cn(...classes: ClassValue[]): string` from `@/utils/cn`; `twMergeConfig`; `tv` and `type VariantProps` from `@/utils/tv`; `PolymorphicComponentProps<T, P>` from `@/utils/polymorphic`; `recursiveCloneChildren(...)` from `@/utils/recursive-clone-children`.

- [ ] **Step 1: Add dependencies**

```bash
yarn add -E tailwind-variants@3.3.1 tailwind-merge@3.7.0 clsx@2.1.1
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/cn.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cn } from '@/utils/cn';

describe('cn', () => {
  it('keeps an Align font size next to an Align text colour', () => {
    // Both start with "text-"; without the custom font-size group tailwind-merge
    // treats them as the same group and drops one.
    expect(cn('text-label-sm', 'text-text-sub-600')).toBe('text-label-sm text-text-sub-600');
  });

  it('lets the later Align font size win', () => {
    expect(cn('text-label-sm', 'text-paragraph-md')).toBe('text-paragraph-md');
  });

  it('lets the later Align shadow and radius win', () => {
    expect(cn('shadow-regular-xs', 'shadow-regular-md')).toBe('shadow-regular-md');
    expect(cn('rounded-10', 'rounded-lg')).toBe('rounded-lg');
  });

  it('still drops falsy values like clsx', () => {
    expect(cn('p-2', false && 'hidden', undefined, 'p-4')).toBe('p-4');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn test tests/unit/cn.test.ts`
Expected: FAIL with `Failed to resolve import "@/utils/cn"`

- [ ] **Step 4: Write the utilities**

Create `src/utils/align-tokens.ts` (names extracted from `src/styles/align-tokens.css`; if that file is ever regenerated, re-extract with `grep -oE -- '--(text|shadow|radius)-[a-z0-9-]+:' src/styles/align-tokens.css | sort -u`):

```ts
/**
 * Align's custom scale names, so tailwind-merge can group them. The starter repo imported
 * these from tailwind.config.ts, which a Tailwind v4 CSS-first project does not have.
 */
export const alignTexts = [
  'doc-label', 'doc-paragraph',
  'label-2xs', 'label-xs', 'label-sm', 'label-md', 'label-lg', 'label-xl',
  'paragraph-xs', 'paragraph-sm', 'paragraph-md', 'paragraph-lg', 'paragraph-xl',
  'subheading-2xs', 'subheading-xs', 'subheading-sm', 'subheading-md',
  'title-h1', 'title-h2', 'title-h3', 'title-h4', 'title-h5', 'title-h6',
] as const;

export const alignShadows = [
  'button-error-focus', 'button-important-focus', 'button-primary-focus',
  'colored-gray', 'complex', 'complex-2', 'complex-4', 'complex-5', 'complex-6', 'complex-7',
  'complex-8', 'complex-9', 'complex-10', 'complex-11', 'complex-12',
  'custom-input', 'custom-input-2', 'custom-input-3', 'custom-input-4', 'custom-input-active',
  'custom-xs', 'custom-sm', 'custom-md', 'custom-lg',
  'fancy-buttons-error', 'fancy-buttons-neutral', 'fancy-buttons-primary', 'fancy-buttons-stroke',
  'gray-shadow', 'gray-shadow-4', 'regular-xs', 'regular-sm', 'regular-md',
  'switch-thumb', 'toggle-switch', 'tooltip',
] as const;

export const alignRadii = ['10', '20'] as const;
```

Create `src/utils/cn.ts`:

```ts
import clsx, { type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { alignRadii, alignShadows, alignTexts } from '@/utils/align-tokens';

export { type ClassValue } from 'clsx';

export const twMergeConfig = {
  extend: {
    classGroups: {
      'font-size': [{ text: [...alignTexts] }],
      shadow: [{ shadow: [...alignShadows] }],
      rounded: [{ rounded: [...alignRadii] }],
    },
  },
};

const customTwMerge = extendTailwindMerge(twMergeConfig);

/** clsx plus a tailwind-merge that knows Align's custom scales. */
export function cn(...classes: ClassValue[]) {
  return customTwMerge(clsx(...classes));
}
```

Create `src/utils/tv.ts`:

```ts
import { createTV } from 'tailwind-variants';
import { twMergeConfig } from '@/utils/cn';

export type { VariantProps, ClassValue } from 'tailwind-variants';

export const tv = createTV({ twMergeConfig });
```

Vendor the two verbatim helpers and the CSS-custom-property typing:

```bash
S=https://raw.githubusercontent.com/alignui/alignui-nextjs-typescript-starter/f37bd913a058ceca39d5bfc2369ec420018e5716
curl -sfL "$S/utils/polymorphic.ts" -o src/utils/polymorphic.ts
curl -sfL "$S/utils/recursive-clone-children.tsx" -o src/utils/recursive-clone-children.tsx
curl -sfL "$S/global.d.ts" -o src/global.d.ts
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn test tests/unit/cn.test.ts`
Expected: PASS (4 tests)

If `tailwind-variants` 3 rejects the `twMergeConfig` shape at type level, check `node_modules/tailwind-variants/dist/index.d.ts` for the `createTV` config type and adapt `tv.ts` only — the test above must still pass unchanged.

- [ ] **Step 6: Lint override for vendored code**

`src/utils/polymorphic.ts` uses `Props = {}`, which `@typescript-eslint/no-empty-object-type` rejects. Vendored code is not rewritten for style. In `eslint.config.mjs`, add after `...nextTs,`:

```js
  // Vendored Align UI / Kibo UI source (spec §3.4): kept close to upstream so updates can be
  // diffed, so only the rules upstream does not follow are relaxed, and only here.
  {
    files: [
      "src/components/ui/**",
      "src/components/kibo-ui/**",
      "src/utils/polymorphic.ts",
      "src/utils/recursive-clone-children.tsx",
    ],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
```

Run: `yarn lint`
Expected: PASS. If a vendored file fails on another rule, add that one rule name to this override's `rules` (never to the global config) and re-run.

- [ ] **Step 7: Gate and commit**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass.

```bash
git add package.json yarn.lock src/utils src/global.d.ts tests/unit/cn.test.ts eslint.config.mjs
git commit -m "feat(ui): Align cn/tv utilities with token-aware tailwind-merge"
```

---

### Task 3: Move the shadcn components to `legacy-ui`

**Files:**
- Move: `src/components/ui/*.tsx` → `src/components/legacy-ui/*.tsx`
- Modify: every file importing `@/components/ui/…` (19 app files + `src/app/layout.tsx`)

**Interfaces:**
- Produces: `@/components/legacy-ui/{avatar,badge,button,dialog,dropdown-menu,input,label,select,sheet,sonner}` with their existing exports, unchanged. `src/components/ui/` is empty afterwards, ready for Align.

- [ ] **Step 1: Move and repoint**

```bash
mkdir -p src/components/legacy-ui
git mv src/components/ui/*.tsx src/components/legacy-ui/
grep -rl "@/components/ui/" src | xargs sed -i "s#@/components/ui/#@/components/legacy-ui/#g"
grep -rn "@/components/ui/" src && echo "LEFTOVER IMPORTS" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 2: Mark the directory as temporary**

Create `src/components/legacy-ui/README.md`:

```markdown
# legacy-ui (temporary)

The shadcn/radix-nova components, moved here so screens keep working while they are rebuilt on
Align UI (docs/superpowers/specs/2026-09-24-ui-reset-design.md §10 A6). Do not import from here
in new code. The whole directory is deleted in Part 4 of the UI reset plan.
```

- [ ] **Step 3: Gate, including e2e**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass.

Run: `yarn db:up && yarn e2e`
Expected: all specs in `auth.spec.ts`, `board.spec.ts`, `comments.spec.ts` pass. (Screens now render with Align colours through the bridge; behaviour is unchanged.)

- [ ] **Step 4: Commit**

```bash
git add -A src/components src/app
git commit -m "refactor(ui): move shadcn components to legacy-ui ahead of the Align rebuild"
```

---

### Task 4: Vendor the Align primitives

**Files:**
- Create (vendored + transformed): `src/components/ui/{avatar,avatar-empty-icons,badge,button,compact-button,divider,drawer,dropdown,hint,input,label,modal,popover,radio,select,status-badge,switch,tooltip}.tsx`
- Modify: `src/components/ui/drawer.tsx` (add `side`)
- Test: `tests/unit/vendored-ui.test.ts`, `tests/unit/align-render.test.ts`

**Interfaces:**
- Produces (namespace imports, e.g. `import * as Button from '@/components/ui/button'`):
  - `Button.Root` (`variant: 'primary'|'neutral'|'error'`, `mode: 'filled'|'stroke'|'lighter'|'ghost'`, `size: 'medium'|'small'|'xsmall'|'xxsmall'`, `asChild`), `Button.Icon` (`as={TablerIcon}`)
  - `CompactButton.Root` (`variant: 'stroke'|'ghost'|'white'|'modifiable'`, `size: 'large'|'medium'`, `fullRadius`), `CompactButton.Icon`
  - `Input.Root` (`size`, `hasError`), `Input.Wrapper`, `Input.Input`, `Input.Icon`, `Input.Affix`, `Input.InlineAffix`
  - `Label.Root` (`htmlFor`, `disabled`), `Label.Asterisk`, `Label.Sub`
  - `Hint.Root` (`hasError`, `disabled`), `Hint.Icon`
  - `Select.Root` (`size: 'medium'|'small'|'xsmall'`, `variant: 'default'|'compact'|'compactForInput'`, `hasError`, plus Radix Select props), `Select.Trigger`, `Select.Value`, `Select.Content`, `Select.Item`, `Select.Group`, `Select.GroupLabel`, `Select.Separator`, `Select.TriggerIcon`, `Select.ItemIcon`
  - `Modal.Root`, `Modal.Trigger`, `Modal.Close`, `Modal.Content` (`showClose`, `overlayClassName`), `Modal.Header` (`icon?: TablerIcon`, `title`, `description`), `Modal.Title`, `Modal.Description`, `Modal.Body`, `Modal.Footer`
  - `Drawer.Root`, `Drawer.Trigger`, `Drawer.Close`, `Drawer.Content` (`side?: 'left'|'right'`, default `'right'`), `Drawer.Header` (`showCloseButton`), `Drawer.Title`, `Drawer.Body`, `Drawer.Footer`
  - `Dropdown.Root`, `Dropdown.Trigger`, `Dropdown.Content`, `Dropdown.Item`, `Dropdown.ItemIcon`, `Dropdown.Group`, `Dropdown.Label`, `Dropdown.Separator`, `Dropdown.CheckboxItem`, `Dropdown.MenuSub…`
  - `Badge.Root` (`variant: 'filled'|'light'|'lighter'|'stroke'`, `color: 'gray'|'blue'|'orange'|'red'|'green'|'yellow'|'purple'|'sky'|'pink'|'teal'`, `size: 'small'|'medium'`, `square`), `Badge.Icon`, `Badge.Dot`
  - `StatusBadge.Root` (`variant: 'stroke'|'light'`, `status: 'completed'|'pending'|'failed'|'disabled'`), `StatusBadge.Icon`, `StatusBadge.Dot`
  - `Avatar.Root` (`size: '20'|'24'|'32'|'40'|'48'|'56'|'64'|'72'|'80'`, `color: 'gray'|'yellow'|'blue'|'sky'|'purple'|'red'`), `Avatar.Image`
  - `Radio.Group`, `Radio.Item`; `Switch.Root`; `Tooltip.Provider`, `Tooltip.Root`, `Tooltip.Trigger`, `Tooltip.Content` (`size`, `variant: 'dark'|'light'`); `Popover.Root`, `Popover.Trigger`, `Popover.Anchor`, `Popover.Content`, `Popover.Close`; `Divider.Root` (`variant`)

- [ ] **Step 1: Add dependencies**

```bash
yarn add -E @tabler/icons-react@3.48.0 \
  @radix-ui/react-slot@1.3.3 @radix-ui/react-dialog@1.1.23 \
  @radix-ui/react-dropdown-menu@2.1.24 @radix-ui/react-label@2.1.15 \
  @radix-ui/react-popover@1.1.23 @radix-ui/react-radio-group@1.4.7 \
  @radix-ui/react-select@2.3.7 @radix-ui/react-scroll-area@1.2.18 \
  @radix-ui/react-switch@1.3.7 @radix-ui/react-tooltip@1.2.16
```

- [ ] **Step 2: Write the failing guard test**

Create `tests/unit/vendored-ui.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = 'src/components/ui';
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

describe('vendored Align components', () => {
  it('exist', () => {
    expect(files).toEqual(expect.arrayContaining([
      'button.tsx', 'input.tsx', 'label.tsx', 'select.tsx', 'modal.tsx', 'drawer.tsx',
      'dropdown.tsx', 'badge.tsx', 'avatar.tsx', 'radio.tsx', 'switch.tsx', 'tooltip.tsx',
    ]));
  });

  for (const file of files) {
    const src = readFileSync(join(dir, file), 'utf8');

    it(`${file} uses Tabler icons only`, () => {
      expect(src).not.toMatch(/remixicon|lucide-react|\bRi[A-Z]\w+/);
    });

    it(`${file} has no Tailwind v3 arbitrary-variable shorthand`, () => {
      // v3's min-w-[--x] is a silent no-op in v4; it must be min-w-(--x).
      expect(src).not.toMatch(/-\[--/);
    });

    if (/from '@radix-ui\//.test(src)) {
      it(`${file} is a client module`, () => {
        expect(src).toMatch(/^(\/\/[^\n]*\n\n)?'use client';/);
      });
    }
  }
});
```

Run: `yarn test tests/unit/vendored-ui.test.ts`
Expected: FAIL — `exist` fails (directory empty).

- [ ] **Step 3: Copy and transform the sources**

```bash
python3 - <<'EOF'
import pathlib, re, urllib.request

SHA = 'f37bd913a058ceca39d5bfc2369ec420018e5716'
BASE = f'https://raw.githubusercontent.com/alignui/alignui-nextjs-typescript-starter/{SHA}/components/ui/'
FILES = ['avatar', 'avatar-empty-icons', 'badge', 'button', 'compact-button', 'divider',
         'drawer', 'dropdown', 'hint', 'input', 'label', 'modal', 'popover', 'radio',
         'select', 'status-badge', 'switch', 'tooltip']
# Spec §10 A8. A KeyError here means upstream uses an icon this map does not cover:
# add its Tabler equivalent rather than skipping it.
ICONS = {
    'RiArrowDownSLine': 'IconChevronDown',
    'RiArrowRightSLine': 'IconChevronRight',
    'RiCheckLine': 'IconCheck',
    'RiCloseLine': 'IconX',
    'RemixiconComponentType': 'TablerIcon',
}

def tabler_import(match):
    names = [n.strip() for n in match.group(1).split(',') if n.strip()]
    out = []
    for n in names:
        is_type = n.startswith('type ')
        out.append(('type ' if is_type else '') + ICONS[n[5:] if is_type else n])
    return "import { " + ', '.join(out) + " } from '@tabler/icons-react';"

out_dir = pathlib.Path('src/components/ui')
out_dir.mkdir(parents=True, exist_ok=True)
for name in FILES:
    src = urllib.request.urlopen(BASE + name + '.tsx').read().decode()
    src = re.sub(r"import \{([^}]*)\} from '@remixicon/react';", tabler_import, src)
    for remix, tabler in ICONS.items():
        src = re.sub(rf'\b{remix}\b', tabler, src)
    src = re.sub(r'-\[--([A-Za-z0-9-]+)\]', r'-(--\1)', src)
    # Upstream keeps icons fully opaque in disabled selects via :not(.remixicon);
    # Tabler icons carry the class tabler-icon.
    src = src.replace('.remixicon', '.tabler-icon')
    if "from '@radix-ui/" in src and "'use client'" not in src:
        src = re.sub(r'^((?://[^\n]*\n\n)?)', r"\1'use client';\n\n", src, count=1)
    (out_dir / f'{name}.tsx').write_text(src)
    print('vendored', name)
EOF
```

- [ ] **Step 4: Give the Drawer a `side`**

The rail's drawer opens from the left; upstream only slides in from the right. In `src/components/ui/drawer.tsx`, replace the whole `DrawerContent` definition (from `const DrawerContent = React.forwardRef<` through `DrawerContent.displayName = 'DrawerContent';`) with:

```tsx
const DrawerContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'left' | 'right';
  }
>(({ className, children, side = 'right', ...rest }, forwardedRef) => {
  return (
    <DrawerPortal>
      <DrawerOverlay className={side === 'left' ? 'place-items-start' : undefined}>
        <DialogPrimitive.Content
          ref={forwardedRef}
          className={cn(
            // base
            'size-full max-w-[400px] overflow-y-auto',
            'border-stroke-soft-200 bg-bg-white-0',
            side === 'left' ? 'border-r' : 'border-l',
            // animation
            'data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=open]:animate-in',
            'data-[state=closed]:duration-200 data-[state=closed]:ease-in data-[state=closed]:animate-out',
            side === 'left'
              ? 'data-[state=open]:slide-in-from-left-full data-[state=closed]:slide-out-to-left-full'
              : 'data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full',
            className,
          )}
          {...rest}
        >
          <div className='relative flex size-full flex-col'>{children}</div>
        </DialogPrimitive.Content>
      </DrawerOverlay>
    </DrawerPortal>
  );
});
DrawerContent.displayName = 'DrawerContent';
```

- [ ] **Step 5: Name the icon-only close buttons**

Upstream's Modal and Drawer close buttons contain only an icon, so screen readers announce "button" with no name. Give them one:

```bash
python3 - <<'EOF'
import pathlib
for name in ['modal', 'drawer']:
    path = pathlib.Path(f'src/components/ui/{name}.tsx')
    src = path.read_text()
    old = "<CompactButton.Icon as={IconX} />"
    assert src.count(old) == 1, (name, src.count(old))
    path.write_text(src.replace(
        old,
        "<CompactButton.Icon as={IconX} aria-hidden='true' />\n                  <span className='sr-only'>Close</span>",
    ))
EOF
```

Add to `tests/unit/vendored-ui.test.ts`, inside the `describe`:

```ts
  it('modal and drawer close buttons have an accessible name', () => {
    for (const file of ['modal.tsx', 'drawer.tsx']) {
      expect(readFileSync(join(dir, file), 'utf8')).toContain("<span className='sr-only'>Close</span>");
    }
  });
```

- [ ] **Step 6: Run the guard test**

Run: `yarn test tests/unit/vendored-ui.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the render smoke test**

Create `tests/unit/align-render.test.ts` (`.ts`, not `.tsx`: vitest only includes `*.test.ts`):

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as Badge from '@/components/ui/badge';
import * as Button from '@/components/ui/button';
import * as Input from '@/components/ui/input';

describe('Align components render with Align token classes', () => {
  it('Button', () => {
    const html = renderToStaticMarkup(createElement(Button.Root, { type: 'submit' }, 'Save'));
    expect(html).toContain('>Save<');
    expect(html).toContain('bg-primary-base');
    expect(html).toContain('text-label-sm');
  });

  it('Badge', () => {
    const html = renderToStaticMarkup(
      createElement(Badge.Root, { variant: 'lighter', color: 'red' }, 'Overdue'),
    );
    expect(html).toContain('Overdue');
  });

  it('Input keeps the id so a <label htmlFor> can name it', () => {
    const html = renderToStaticMarkup(
      createElement(Input.Root, null,
        createElement(Input.Wrapper, null, createElement(Input.Input, { id: 'email' }))),
    );
    expect(html).toContain('id="email"');
  });
});
```

Run: `yarn test tests/unit/align-render.test.ts`
Expected: PASS (3 tests). A failure mentioning `tv` or `twMergeConfig` means Task 2's `tv.ts` needs adapting to tailwind-variants 3 — fix there.

- [ ] **Step 8: Typecheck the vendored code**

Run: `yarn typecheck`
Expected: PASS. Known v4/React 19 frictions and their fixes (apply only if the error appears):
- `React.ElementRef` deprecation warnings are fine; errors are not.
- A `TablerIcon` prop type mismatch where upstream passed a Remix component type: widen the prop to `React.ComponentType<{ className?: string }>` in that one file.

- [ ] **Step 9: Gate and commit**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass.

```bash
git add package.json yarn.lock src/components/ui tests/unit/vendored-ui.test.ts tests/unit/align-render.test.ts
git commit -m "feat(ui): vendor Align UI primitives with Tabler icons and Tailwind v4 fixes"
```

---

### Task 5: Align-styled toasts

**Files:**
- Create: `src/components/ui/toaster.tsx`
- Modify: `src/app/layout.tsx:4` (import)
- Delete: `src/components/legacy-ui/sonner.tsx`

**Interfaces:**
- Consumes: `sonner` (existing, 2.0.8), `next-themes`.
- Produces: `Toaster(props: ToasterProps)` from `@/components/ui/toaster`. Every existing `toast()` / `toast.success()` / `toast.error(msg, { action })` call site keeps working unchanged (spec D5).

- [ ] **Step 1: Write the component**

Create `src/components/ui/toaster.tsx`:

```tsx
'use client';

import {
  IconAlertOctagonFilled, IconAlertTriangleFilled, IconCircleCheckFilled,
  IconInfoCircleFilled, IconLoader2,
} from '@tabler/icons-react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Sonner stays the toast engine, so every toast() call site is untouched (spec D5); only the
 * look is Align's Notification: white surface, soft stroke, regular-md shadow, Align type.
 */
export function Toaster(props: ToasterProps) {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      icons={{
        success: <IconCircleCheckFilled className="size-5 text-success-base" aria-hidden="true" />,
        info: <IconInfoCircleFilled className="size-5 text-information-base" aria-hidden="true" />,
        warning: <IconAlertTriangleFilled className="size-5 text-warning-base" aria-hidden="true" />,
        error: <IconAlertOctagonFilled className="size-5 text-error-base" aria-hidden="true" />,
        loading: <IconLoader2 className="size-5 animate-spin text-text-sub-600" aria-hidden="true" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-full items-start gap-3 rounded-2xl bg-bg-white-0 p-3.5 shadow-regular-md ring-1 ring-inset ring-stroke-soft-200 sm:w-[360px]',
          icon: 'mt-px shrink-0',
          content: 'flex min-w-0 flex-1 flex-col gap-1',
          title: 'text-label-sm text-text-strong-950',
          description: 'text-paragraph-xs text-text-sub-600',
          actionButton:
            'shrink-0 self-center text-label-xs text-primary-base underline-offset-2 hover:underline',
          cancelButton: 'shrink-0 self-center text-label-xs text-text-sub-600 hover:text-text-strong-950',
        },
      }}
      {...props}
    />
  );
}
```

Check the icon names exist before running: `node -e "const t=require('@tabler/icons-react');for (const n of ['IconAlertOctagonFilled','IconAlertTriangleFilled','IconCircleCheckFilled','IconInfoCircleFilled','IconLoader2']) if(!t[n]) {console.error('missing',n);process.exit(1)}"`
Expected: no output.

- [ ] **Step 2: Use it and drop the legacy one**

In `src/app/layout.tsx`, change the import to `import { Toaster } from '@/components/ui/toaster';` and run:

```bash
git rm -q src/components/legacy-ui/sonner.tsx
grep -rn "legacy-ui/sonner" src && echo "LEFTOVER" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 3: Gate and commit**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`
Expected: all pass.

```bash
git add -A src/components/ui/toaster.tsx src/components/legacy-ui src/app/layout.tsx
git commit -m "feat(ui): Align-styled Sonner toaster"
```

---

### Task 6: Auth and new-workspace screens on Align, plus the screenshot script

**Files:**
- Create: `src/components/forms/TextField.tsx`, `src/components/auth/AuthCard.tsx`
- Modify (full rewrite): `src/app/(auth)/layout.tsx`, `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/sign-up/page.tsx`, `src/app/(auth)/invite/[invitationId]/page.tsx`, `src/app/(app)/new-workspace/page.tsx`
- Create: `scripts/screenshots.mjs`

**Interfaces:**
- Consumes: `Input`, `Label`, `Hint`, `Button` from Task 4; `cn` from Task 2.
- Produces:
  - `TextField(props: { id: string; label: string; hint?: string; error?: boolean; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>)` — label + Align input + optional hint; the input's accessible name is exactly `label`.
  - `AuthCard({ title, description?, children })` — card chrome for single-form pages.
  - `FormError({ id?, children })` — `role="alert"` error line (exported from `TextField.tsx`).
  - `scripts/screenshots.mjs` — `node scripts/screenshots.mjs` against a running server writes PNGs to `test-results/screens/`.

- [ ] **Step 1: Shared form pieces**

Create `src/components/forms/TextField.tsx`:

```tsx
import * as Hint from '@/components/ui/hint';
import * as Input from '@/components/ui/input';
import * as Label from '@/components/ui/label';
import { cn } from '@/utils/cn';

type TextFieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: boolean;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'>;

/**
 * Label, Align input and optional hint. The input's accessible name is exactly `label`
 * (e2e locates fields with getByLabel), and the hint is wired up as its description.
 */
export function TextField({ id, label, hint, error, className, ...input }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label.Root htmlFor={id}>{label}</Label.Root>
      <Input.Root hasError={error}>
        <Input.Wrapper>
          <Input.Input id={id} aria-describedby={hintId} aria-invalid={error || undefined} {...input} />
        </Input.Wrapper>
      </Input.Root>
      {hint && <Hint.Root id={hintId}>{hint}</Hint.Root>}
    </div>
  );
}

export function FormError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="text-paragraph-sm text-error-base">
      {children}
    </p>
  );
}
```

Create `src/components/auth/AuthCard.tsx`:

```tsx
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full rounded-20 bg-bg-white-0 p-6 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200">
      <div className="mb-6">
        <h1 className="text-title-h5 text-text-strong-950">{title}</h1>
        {description && <p className="mt-1 text-paragraph-sm text-text-sub-600">{description}</p>}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Auth layout**

Replace `src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg-weak-50 px-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
```

- [ ] **Step 3: Sign in**

Replace `src/app/(auth)/sign-in/page.tsx`:

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import { safeNextPath } from '@/lib/next-path';
import { signIn } from '@/lib/auth-client';

function SignInForm() {
  const router = useRouter();
  // Carried over from sign-up so an invited person who already has an account
  // still lands back on the invitation.
  const next = safeNextPath(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const { error } = await signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });

    if (error) {
      setError(error.message ?? 'Could not sign you in. Try again.');
      setPending(false);
      return;
    }
    router.push(next);
  }

  return (
    <AuthCard title="Sign in" description="Welcome back to your team's work.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField id="email" label="Email" name="email" type="email" required autoComplete="email" />
        <TextField
          id="password" label="Password" name="password" type="password" required
          autoComplete="current-password"
        />

        {error && <FormError>{error}</FormError>}

        <Button.Root type="submit" disabled={pending} className="w-full">
          {pending ? 'Signing in…' : 'Sign in'}
        </Button.Root>

        <p className="text-center text-paragraph-sm text-text-sub-600">
          Don&apos;t have an account?{' '}
          <Link
            href={next === '/' ? '/sign-up' : `/sign-up?next=${encodeURIComponent(next)}`}
            className="text-label-sm text-primary-base underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

// useSearchParams needs a Suspense boundary, or the page cannot be prerendered.
export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
```

- [ ] **Step 4: Sign up**

Replace `src/app/(auth)/sign-up/page.tsx`:

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import { safeNextPath } from '@/lib/next-path';
import { signUp } from '@/lib/auth-client';

function SignUpForm() {
  const router = useRouter();
  // An invitation link sends unauthenticated visitors here with ?next=/invite/<id>,
  // so signing up has to land back on the invitation rather than at the generic
  // "create a workspace" page.
  const next = safeNextPath(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const { error } = await signUp.email({
      name: String(form.get('name')),
      email: String(form.get('email')),
      password: String(form.get('password')),
    });

    if (error) {
      setError(error.message ?? 'Could not create your account. Try again.');
      setPending(false);
      return;
    }
    router.push(next);
  }

  return (
    <AuthCard title="Create your account" description="Start organising your team's work.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField id="name" label="Name" name="name" required autoComplete="name" />
        <TextField id="email" label="Email" name="email" type="email" required autoComplete="email" />
        <TextField
          id="password" label="Password" name="password" type="password" required minLength={8}
          autoComplete="new-password" hint="At least 8 characters."
        />

        {error && <FormError>{error}</FormError>}

        <Button.Root type="submit" disabled={pending} className="w-full">
          {pending ? 'Creating account…' : 'Create account'}
        </Button.Root>

        <p className="text-center text-paragraph-sm text-text-sub-600">
          Already have an account?{' '}
          <Link
            href={next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`}
            className="text-label-sm text-primary-base underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

// useSearchParams needs a Suspense boundary, or the page cannot be prerendered.
export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
```

- [ ] **Step 5: Invitation error page**

Replace `src/app/(auth)/invite/[invitationId]/page.tsx`:

```tsx
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { FormError } from '@/components/forms/TextField';
import { auth } from '@/lib/auth';
import { acceptInvitation } from '@/server/members/service';

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  // Send them to sign up, then straight back here.
  if (!session) redirect(`/sign-up?next=/invite/${invitationId}`);

  const result = await acceptInvitation(session.user.id, session.user.email, invitationId);
  if (result.ok) redirect(`/${result.data.slug}`);

  return (
    <AuthCard title="This invitation cannot be used">
      <div className="flex flex-col gap-3">
        <FormError>{result.error}</FormError>
        <p className="text-paragraph-sm text-text-sub-600">Ask whoever invited you to send a new one.</p>
        <Link href="/" className="text-label-sm text-primary-base underline-offset-4 hover:underline">
          Go to your workspaces
        </Link>
      </div>
    </AuthCard>
  );
}
```

- [ ] **Step 6: New workspace**

Replace `src/app/(app)/new-workspace/page.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import { createWorkspaceAction } from '@/server/workspaces/actions';

export default function NewWorkspacePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const name = String(new FormData(event.currentTarget).get('name'));
    const result = await createWorkspaceAction({ name });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push(`/${result.data.slug}`);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg-weak-50 px-4">
      <div className="w-full max-w-sm">
        <AuthCard title="Create a workspace" description="A workspace holds your projects and your team.">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <TextField id="name" label="Workspace name" name="name" required maxLength={64} autoFocus />
            {error && <FormError>{error}</FormError>}
            <Button.Root type="submit" disabled={pending} className="w-full">
              {pending ? 'Creating…' : 'Create workspace'}
            </Button.Root>
          </form>
        </AuthCard>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Screenshot script (reused by every part)**

Create `scripts/screenshots.mjs`:

```js
// Visual check for the UI reset (spec §8). Needs a running server:
//   DATABASE_URL=$DATABASE_URL_TEST yarn build && DATABASE_URL=$DATABASE_URL_TEST yarn start
// then: node scripts/screenshots.mjs [baseURL]
// Writes test-results/screens/<page>-<width>-<theme>.png for review.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = 'test-results/screens';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const setup = await browser.newPage({ baseURL: base });
const stamp = Date.now();
await setup.goto('/sign-up');
await setup.getByLabel('Name').fill('Screen Shot');
await setup.getByLabel('Email').fill(`screens-${stamp}@example.com`);
await setup.getByLabel('Password').fill('correct-horse-battery');
await setup.getByRole('button', { name: 'Create account' }).click();
await setup.getByLabel('Workspace name').fill(`Screens ${stamp}`);
await setup.getByRole('button', { name: 'Create workspace' }).click();
await setup.getByRole('button', { name: 'New project' }).click();
await setup.getByLabel('Project name').fill('Website');
await setup.getByRole('button', { name: 'Create project' }).click();
for (const title of ['Write the landing copy', 'Pick a hero image', 'Ship it']) {
  await setup.getByPlaceholder('Add a task…').fill(title);
  await setup.getByPlaceholder('Add a task…').press('Enter');
  await setup.getByText(title).waitFor();
}
const projectUrl = setup.url();
const workspaceUrl = new URL(projectUrl).pathname.split('/').slice(0, 2).join('/');
const storage = await setup.context().storageState();
await setup.close();

const pages = [
  ['sign-in', '/sign-in', false],
  ['home', workspaceUrl, true],
  ['list', new URL(projectUrl).pathname, true],
  ['board', `${new URL(projectUrl).pathname}/board`, true],
  ['settings-general', `${workspaceUrl}/settings/general`, true],
  ['settings-members', `${workspaceUrl}/settings/members`, true],
];

for (const width of [1280, 390]) {
  for (const theme of ['light', 'dark']) {
    for (const [name, path, authed] of pages) {
      const context = await browser.newContext({
        baseURL: base,
        viewport: { width, height: 900 },
        storageState: authed ? storage : undefined,
      });
      // next-themes reads localStorage "theme" before first paint.
      await context.addInitScript((t) => localStorage.setItem('theme', t), theme);
      const page = await context.newPage();
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${out}/${name}-${width}-${theme}.png`, fullPage: true });
      if (name === 'list') {
        await page.getByRole('button', { name: 'Write the landing copy', exact: true }).click();
        await page.getByRole('dialog').waitFor();
        await page.screenshot({ path: `${out}/task-dialog-${width}-${theme}.png`, fullPage: true });
      }
      await context.close();
    }
  }
}

await browser.close();
console.log(`screenshots written to ${out}/`);
```

- [ ] **Step 8: Gate, e2e and visual check**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass.

Run: `yarn e2e`
Expected: all pass (the auth and sign-up steps of every spec now run through the Align forms).

Run the screenshot script against a production build on the test database (see the header comment), then open `test-results/screens/sign-in-*.png`. Check: Inter font, Align input and button styling, visible labels, no unstyled (black-border) inputs, light and dark both readable. Tab through the sign-in form in a browser once: every field and the button show a focus indicator.

- [ ] **Step 9: Commit**

```bash
git add src/components/forms src/components/auth "src/app/(auth)" "src/app/(app)/new-workspace" scripts/screenshots.mjs
git commit -m "feat(ui): rebuild auth and new-workspace screens on Align"
```
