'use client';

import * as React from 'react';
import * as Radio from '@/components/ui/radio';
import { cn } from '@/utils/cn';

export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof Radio.Group>,
  React.ComponentPropsWithoutRef<typeof Radio.Group>
>(({ className, ...props }, ref) => (
  <Radio.Group ref={ref} className={cn('flex flex-col gap-3', className)} {...props} />
));
RadioGroup.displayName = 'RadioGroup';

export const RadioGroupItem = Radio.Item;
