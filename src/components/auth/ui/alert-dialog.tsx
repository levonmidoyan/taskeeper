'use client';

import * as React from 'react';
import * as Modal from '@/components/ui/modal';
import { Button, type ButtonVariantProps } from '@/components/auth/ui/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/auth/ui/dialog';
import { cn } from '@/utils/cn';

export const AlertDialog = Modal.Root;
export const AlertDialogHeader = DialogHeader;
export const AlertDialogFooter = DialogFooter;
export const AlertDialogTitle = DialogTitle;
export const AlertDialogDescription = DialogDescription;

/** A modal that only closes through its buttons or Escape — never an outside click. */
export const AlertDialogContent = React.forwardRef<
  React.ComponentRef<typeof Modal.Content>,
  React.ComponentPropsWithoutRef<typeof Modal.Content>
>(({ className, ...props }, ref) => (
  <Modal.Content
    ref={ref}
    role="alertdialog"
    showClose={false}
    onPointerDownOutside={(event) => event.preventDefault()}
    className={cn('grid gap-4 p-6', className)}
    {...props}
  />
));
AlertDialogContent.displayName = 'AlertDialogContent';

export function AlertDialogCancel({
  variant = 'outline',
  ...props
}: React.ComponentProps<typeof Button> & ButtonVariantProps) {
  return (
    <Modal.Close asChild>
      <Button variant={variant} {...props} />
    </Modal.Close>
  );
}

export function AlertDialogAction(props: React.ComponentProps<typeof Button> & ButtonVariantProps) {
  return <Button {...props} />;
}
