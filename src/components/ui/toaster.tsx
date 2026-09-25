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
