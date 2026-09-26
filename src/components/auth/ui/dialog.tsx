'use client';

import * as React from 'react';
import * as Modal from '@/components/ui/modal';
import { cn } from '@/utils/cn';

export const Dialog = Modal.Root;

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof Modal.Content>,
  React.ComponentPropsWithoutRef<typeof Modal.Content>
>(({ className, ...props }, ref) => (
  <Modal.Content ref={ref} className={cn('grid gap-4 p-6', className)} {...props} />
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pr-8', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof Modal.Title>,
  React.ComponentPropsWithoutRef<typeof Modal.Title>
>(({ className, ...props }, ref) => (
  <Modal.Title ref={ref} className={cn('text-label-lg', className)} {...props} />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof Modal.Description>,
  React.ComponentPropsWithoutRef<typeof Modal.Description>
>(({ className, ...props }, ref) => (
  <Modal.Description ref={ref} className={cn('text-paragraph-sm', className)} {...props} />
));
DialogDescription.displayName = 'DialogDescription';
