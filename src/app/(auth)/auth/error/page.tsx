import { headers } from 'next/headers';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/auth/ui/card';
import { FormError } from '@/components/forms/TextField';
import { auth } from '@/lib/auth';

// Codes Better Auth (or the provider, passed through) puts in ?error= when a
// Google sign-in or account link fails, matched with spaces read as "_"
// ("account not linked" arrives spelled that way). Anything else gets the
// generic line.
// error_description is never shown: it comes straight from the URL, so anyone
// could put their own text on this page.
const MESSAGES: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled.',
  state_mismatch: 'That sign-in link has expired or was opened in another browser.',
  state_not_found: 'That sign-in link has expired or was opened in another browser.',
  account_not_linked: 'An account with this email already exists. Sign in with your password instead.',
  account_already_linked_to_different_user: 'This Google account is already linked to another Taskeeper account.',
  email_does_not_match: 'This Google account uses a different email than yours.',
  unable_to_link_account: 'This Google account could not be linked.',
  email_not_found: 'Google did not share an email address for this account.',
  email_not_verified: 'Google has not verified the email address on this account.',
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const code = typeof error === 'string' ? error.toLowerCase().replaceAll(' ', '_') : '';
  const message = MESSAGES[code] ?? 'Something went wrong while signing in.';
  // A failed account link comes back here signed in; a failed sign-in does not.
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{session ? 'Could not link the account' : 'Could not sign you in'}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FormError>{message}</FormError>
        <p className="text-paragraph-sm text-text-sub-600">Please try again.</p>
        <Link
          href={session ? '/settings/security' : '/auth/sign-in'}
          className="text-label-sm text-primary-base underline-offset-4 hover:underline"
        >
          {session ? 'Back to settings' : 'Back to sign in'}
        </Link>
      </CardContent>
    </Card>
  );
}
