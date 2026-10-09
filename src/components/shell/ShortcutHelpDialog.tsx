'use client';

import * as Modal from '@/components/ui/modal';
import { formatBinding } from '@/lib/shortcuts/keys';
import { useIsMac } from '@/lib/shortcuts/provider';
import { SHORTCUT_GROUPS, SHORTCUTS } from '@/lib/shortcuts/registry';

/** Every shortcut, straight from the registry, so the list cannot drift from what the keys do. */
export function ShortcutHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const isMac = useIsMac();
  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content aria-describedby={undefined} className="max-w-3xl">
        <div className="max-h-[80vh] overflow-y-auto p-5">
          <Modal.Title className="text-label-lg text-text-strong-950">Keyboard shortcuts</Modal.Title>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group} aria-labelledby={`shortcuts-${group}`}>
                <h3 id={`shortcuts-${group}`} className="text-label-sm text-text-sub-600">{group}</h3>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 text-paragraph-sm">
                      <dt className="text-text-strong-950">{s.label}</dt>
                      <dd className="flex shrink-0 items-center gap-1 text-paragraph-xs text-text-soft-400">
                        {s.keys.map((spec, i) => (
                          <span key={spec} className="flex items-center gap-1">
                            {i > 0 && <span>or</span>}
                            {formatBinding(spec, isMac).map((caps, j) => (
                              <span key={j} className="flex items-center gap-1">
                                {j > 0 && <span>then</span>}
                                {caps.map((cap) => (
                                  <kbd key={cap} className="min-w-5 rounded border border-stroke-soft-200 px-1.5 text-center text-label-xs text-text-sub-600">
                                    {cap}
                                  </kbd>
                                ))}
                              </span>
                            ))}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}
