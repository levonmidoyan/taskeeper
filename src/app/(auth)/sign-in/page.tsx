'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import { safeNextPath } from '@/lib/next-path';
import { signIn } from '@/lib/auth-client';

function SignInForm() {
  const router = useRouter();
  // Carried over from sign-up so an invited person who already has an account
  // still lands back on the invitation.
  const next = safeNextPath(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const { error } = await signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });

    if (error) {
      setError(error.message ?? 'Could not sign you in. Try again.');
      setPending(false);
      return;
    }
    router.push(next);
  }

  return (
    <AuthCard title="Sign in" description="Welcome back to your team's work.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField id="email" label="Email" name="email" type="email" required autoComplete="email" />
        <TextField
          id="password" label="Password" name="password" type="password" required
          autoComplete="current-password"
        />

        {error && <FormError>{error}</FormError>}

        <Button.Root type="submit" disabled={pending} className="w-full">
          {pending ? 'Signing in…' : 'Sign in'}
        </Button.Root>

        <p className="text-center text-paragraph-sm text-text-sub-600">
          Don&apos;t have an account?{' '}
          <Link
            href={next === '/' ? '/sign-up' : `/sign-up?next=${encodeURIComponent(next)}`}
            className="text-label-sm text-primary-base underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

// useSearchParams needs a Suspense boundary, or the page cannot be prerendered.
export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
