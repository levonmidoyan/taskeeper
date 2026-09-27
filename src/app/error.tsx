'use client';

import { ErrorScreen } from '@/components/brand/ErrorScreen';

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <title>Something went wrong · Taskeeper</title>
      <ErrorScreen {...props} />
    </>
  );
}
