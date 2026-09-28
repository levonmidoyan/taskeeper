'use client';

import { IconBolt, IconLayoutKanban, IconUsersGroup } from '@tabler/icons-react';
import Link from 'next/link';
import { createContext, useContext } from 'react';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/utils/cn';

/*
 * Split screen for every signed-out and onboarding screen: the form column on the left,
 * a brand panel with a live-looking board preview on the right (lg and up). The card the
 * form renders loses its chrome here, since the column itself is the surface.
 *
 * Nested shells collapse: the root not-found/error pages bring their own shell, but when
 * they're thrown under (auth)/layout they render inside its shell, so they pass through.
 */
const InsideAuthShell = createContext(false);

export function AuthShell({ children }: { children: React.ReactNode }) {
  if (useContext(InsideAuthShell)) return children;

  return (
    <InsideAuthShell value={true}>
      <div className="grid min-h-dvh bg-bg-white-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="aurora aurora-soft relative flex min-w-0 flex-col px-4 py-6 sm:px-10 lg:before:hidden">
          <header>
            <Link href="/" className="inline-flex rounded-lg text-text-strong-950" aria-label="Taskeeper home">
              <Logo />
            </Link>
          </header>

          <main className="flex flex-1 items-center justify-center py-10">
            <div
              className={cn(
                'w-full max-w-sm animate-rise',
                // Strip the card chrome: on mobile the aurora shows through, on desktop the column is the card.
                '*:data-[slot=card]:bg-transparent *:data-[slot=card]:p-0 *:data-[slot=card]:shadow-none *:data-[slot=card]:ring-0',
                '*:data-[slot=card]:gap-8',
                '[&_[data-slot=card-title]]:text-title-h4 [&_[data-slot=card-title]]:tracking-tight',
              )}
            >
              {children}
            </div>
          </main>

          <footer className="text-paragraph-xs text-text-soft-400">
            © {new Date().getFullYear()} Taskeeper · Task management for small teams
          </footer>
        </div>

        <BrandPanel />
      </div>
    </InsideAuthShell>
  );
}

const features = [
  {
    icon: IconLayoutKanban,
    title: 'Boards and lists',
    text: 'Switch views without losing context.',
  },
  {
    icon: IconBolt,
    title: 'Fast by default',
    text: 'Quick-add, slash commands, instant saves.',
  },
  {
    icon: IconUsersGroup,
    title: 'Made for small teams',
    text: 'Invite, assign and ship together.',
  },
];

function BrandPanel() {
  return (
    <aside
      aria-hidden="true"
      className="aurora relative m-3 hidden flex-col justify-between rounded-[28px] bg-slate-950 p-12 text-white lg:flex"
    >
      <div className="dot-grid pointer-events-none absolute inset-0 text-white/10" />

      <span className="relative inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-label-xs text-white/80 ring-1 ring-inset ring-white/15 backdrop-blur">
        <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
        Your team&apos;s work, in one calm place
      </span>

      <div className="relative space-y-10">
        <h2 className="max-w-md text-title-h2 tracking-tight">
          Plan less,
          <br />
          <span className="bg-linear-to-r from-indigo-300 via-fuchsia-300 to-sky-300 bg-clip-text text-transparent">
            ship more
          </span>
        </h2>
        <BoardPreview />
      </div>

      <ul className="relative grid grid-cols-3 gap-6">
        {features.map(({ icon: Icon, title, text }) => (
          <li key={title} className="space-y-2">
            <span className="flex size-9 items-center justify-center rounded-10 bg-white/10 ring-1 ring-inset ring-white/15">
              <Icon className="size-5 text-indigo-200" stroke={1.75} />
            </span>
            <p className="text-label-sm text-white">{title}</p>
            <p className="text-paragraph-xs text-white/60">{text}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}

type PreviewTask = {
  title: string;
  tag: string;
  tone: string;
  who: string;
  hue: string;
  done?: boolean;
};

const columns: { name: string; count: number; tasks: PreviewTask[] }[] = [
  {
    name: 'To do',
    count: 4,
    tasks: [
      {
        title: 'Draft launch email',
        tag: 'Marketing',
        tone: 'bg-fuchsia-400/20 text-fuchsia-200',
        who: 'AK',
        hue: 'bg-fuchsia-500',
      },
      {
        title: 'Pricing page copy',
        tag: 'Web',
        tone: 'bg-sky-400/20 text-sky-200',
        who: 'MR',
        hue: 'bg-sky-500',
      },
    ],
  },
  {
    name: 'In progress',
    count: 2,
    tasks: [
      {
        title: 'Onboarding checklist',
        tag: 'Product',
        tone: 'bg-indigo-400/25 text-indigo-200',
        who: 'JL',
        hue: 'bg-indigo-500',
      },
    ],
  },
  {
    name: 'Done',
    count: 9,
    tasks: [
      {
        title: 'Invite flow',
        tag: 'Product',
        tone: 'bg-indigo-400/25 text-indigo-200',
        who: 'SO',
        hue: 'bg-emerald-500',
        done: true,
      },
    ],
  },
];

function BoardPreview() {
  return (
    <div className="animate-float rounded-20 bg-white/[0.06] p-4 shadow-2xl shadow-indigo-950/60 ring-1 ring-inset ring-white/15 backdrop-blur-md">
      <div className="mb-4 flex items-center gap-2 px-1">
        <span className="size-2.5 rounded-full bg-indigo-400" />
        <span className="text-label-sm text-white">Launch week</span>
        <span className="ml-auto flex -space-x-1.5">
          {['bg-fuchsia-500', 'bg-sky-500', 'bg-indigo-500', 'bg-emerald-500'].map((c) => (
            <span key={c} className={cn('size-5 rounded-full ring-2 ring-slate-900', c)} />
          ))}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {columns.map((col) => (
          <div key={col.name} className="space-y-2 rounded-xl bg-white/[0.04] p-2">
            <div className="flex items-center justify-between px-1 text-label-xs text-white/70">
              {col.name}
              <span className="tabular text-white/40">{col.count}</span>
            </div>
            {col.tasks.map((t) => (
              <div key={t.title} className="space-y-2 rounded-lg bg-white/[0.08] p-2.5 ring-1 ring-inset ring-white/10">
                <p className={cn('text-label-xs text-white', t.done && 'text-white/50 line-through')}>{t.title}</p>
                <div className="flex items-center justify-between">
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', t.tone)}>{t.tag}</span>
                  <span
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full text-[9px] font-semibold',
                      t.hue,
                    )}
                  >
                    {t.who}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
