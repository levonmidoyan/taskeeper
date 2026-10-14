'use client';

import * as Button from '@/components/ui/button';

export function OfflineRetry() {
  return <Button.Root size="small" onClick={() => location.reload()}>Try again</Button.Root>;
}
