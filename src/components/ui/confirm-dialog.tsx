'use client';

import { IconAlertTriangle } from '@tabler/icons-react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import * as Button from '@/components/ui/button';
import * as Modal from '@/components/ui/modal';

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** Label for the confirming button. Defaults to "Delete". */
  confirmLabel?: string;
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * Promise-based stand-in for window.confirm(): `if (!(await confirm({ title }))) return;`
 * Resolves false on Cancel, Escape, or a click outside.
 */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  // No Trigger to hand focus back to, so remember what had it.
  const returnFocus = useRef<HTMLElement | null>(null);

  const confirm = useCallback<Confirm>((next) => {
    resolver.current?.(false);
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function settle(ok: boolean) {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal.Root open={open} onOpenChange={(next) => !next && settle(false)}>
        <Modal.Content
          role="alertdialog"
          showClose={false}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <div className="flex flex-col items-center gap-4 px-5 pb-5 pt-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-error-lighter">
              <IconAlertTriangle className="size-6 text-error-base" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-1">
              <Modal.Title className="text-label-md">{options?.title}</Modal.Title>
              {options?.description && <Modal.Description className="text-paragraph-sm">{options.description}</Modal.Description>}
            </div>
          </div>
          <Modal.Footer>
            <Button.Root
              type="button"
              variant="neutral"
              mode="stroke"
              size="small"
              className="w-full"
              onClick={() => settle(false)}
              autoFocus
            >
              Cancel
            </Button.Root>
            <Button.Root type="button" variant="error" size="small" className="w-full" onClick={() => settle(true)}>
              {options?.confirmLabel ?? 'Delete'}
            </Button.Root>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    </ConfirmContext.Provider>
  );
}
