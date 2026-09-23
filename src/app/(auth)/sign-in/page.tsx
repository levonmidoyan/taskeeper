'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <form onSubmit={onSubmit} className="space-y-5 rounded-[var(--radius-panel)] border border-border bg-card p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Welcome back to your team&apos;s work.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" className="h-11 text-base" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password" name="password" type="password" required
          autoComplete="current-password"
          className="h-11 text-base"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link
          href={next === '/' ? '/sign-up' : `/sign-up?next=${encodeURIComponent(next)}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          Create one
        </Link>
      </p>
    </form>
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
