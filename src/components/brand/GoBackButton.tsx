'use client';

import { IconArrowLeft } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import * as Button from '@/components/ui/button';

/** History back, falling back to home when the page was opened directly (no history entry). */
export function GoBackButton() {
  const router = useRouter();
  return (
    <Button.Root
      variant="neutral"
      mode="stroke"
      className="w-full"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}
    >
      <Button.Icon as={IconArrowLeft} />
      Go back
    </Button.Root>
  );
}
