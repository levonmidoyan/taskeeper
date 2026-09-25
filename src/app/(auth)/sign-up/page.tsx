'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import { safeNextPath } from '@/lib/next-path';
import { signUp } from '@/lib/auth-client';

function SignUpForm() {
  const router = useRouter();
  // An invitation link sends unauthenticated visitors here with ?next=/invite/<id>,
  // so signing up has to land back on the invitation rather than at the generic
  // "create a workspace" page.
  const next = safeNextPath(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const { error } = await signUp.email({
      name: String(form.get('name')),
      email: String(form.get('email')),
      password: String(form.get('password')),
    });

    if (error) {
      setError(error.message ?? 'Could not create your account. Try again.');
      setPending(false);
      return;
    }
    router.push(next);
  }

  return (
    <AuthCard title="Create your account" description="Start organising your team's work.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField id="name" label="Name" name="name" required autoComplete="name" />
        <TextField id="email" label="Email" name="email" type="email" required autoComplete="email" />
        <TextField
          id="password" label="Password" name="password" type="password" required minLength={8}
          autoComplete="new-password" hint="At least 8 characters."
        />

        {error && <FormError>{error}</FormError>}

        <Button.Root type="submit" disabled={pending} className="w-full">
          {pending ? 'Creating account…' : 'Create account'}
        </Button.Root>

        <p className="text-center text-paragraph-sm text-text-sub-600">
          Already have an account?{' '}
          <Link
            href={next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`}
            className="text-label-sm text-primary-base underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

// useSearchParams needs a Suspense boundary, or the page cannot be prerendered.
export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
