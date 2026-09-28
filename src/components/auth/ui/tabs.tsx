'use client';

import * as React from 'react';
import * as TabMenu from '@/components/ui/tab-menu-horizontal';
import { cn } from '@/utils/cn';

export const Tabs = TabMenu.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabMenu.List>,
  React.ComponentPropsWithoutRef<typeof TabMenu.List> & { variant?: 'default' | 'line' }
>(({ variant: _variant, ...props }, ref) => <TabMenu.List ref={ref} {...props} />);
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabMenu.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabMenu.Trigger>
>(({ className, ...props }, ref) => (
  // Registry icons are unsized.
  <TabMenu.Trigger ref={ref} className={cn('[&_svg]:size-5 [&_svg]:shrink-0', className)} {...props} />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabMenu.Content>,
  React.ComponentPropsWithoutRef<typeof TabMenu.Content>
>(({ className, ...props }, ref) => (
  <TabMenu.Content ref={ref} className={cn('flex-1 outline-none', className)} {...props} />
));
TabsContent.displayName = 'TabsContent';
