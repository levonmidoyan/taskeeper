'use client';

import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { AuthShell } from '@/components/brand/AuthShell';
import { StatusScreen } from '@/components/brand/StatusScreen';
import * as Button from '@/components/ui/button';

/** Shared body of error.tsx and global-error.tsx. */
export function ErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AuthShell>
      <StatusScreen
        code="500"
        icon={IconAlertTriangle}
        title="Something went wrong"
        description="An unexpected error stopped this page from loading. Your work is saved — try again, and if it keeps happening, let us know."
        footnote={
          error.digest && (
            <>
              Reference: <code className="font-mono text-text-sub-600">{error.digest}</code>
            </>
          )
        }
      >
        <Button.Root className="w-full" onClick={() => retry()}>
          <Button.Icon as={IconRefresh} />
          Try again
        </Button.Root>
        <Button.Root asChild variant="neutral" mode="stroke" className="w-full">
          <Link href="/">Back to Taskeeper</Link>
        </Button.Root>
      </StatusScreen>
    </AuthShell>
  );
}
