import { IconMapPinQuestion } from '@tabler/icons-react';
import Link from 'next/link';
import { AuthShell } from '@/components/brand/AuthShell';
import { DocumentTitle } from '@/components/brand/DocumentTitle';
import { GoBackButton } from '@/components/brand/GoBackButton';
import { StatusScreen } from '@/components/brand/StatusScreen';
import * as Button from '@/components/ui/button';

export default function NotFound() {
  return (
    <AuthShell>
      <DocumentTitle>Page not found · Taskeeper</DocumentTitle>
      <StatusScreen
        code="404"
        icon={IconMapPinQuestion}
        title="This page wandered off"
        description="The link may be broken, or the page was moved or deleted. It's also possible you don't have access to it."
      >
        <Button.Root asChild className="w-full">
          <Link href="/">Back to Taskeeper</Link>
        </Button.Root>
        <GoBackButton />
      </StatusScreen>
    </AuthShell>
  );
}
