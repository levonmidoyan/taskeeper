import { viewPaths } from '@better-auth-ui/core';
import { redirect } from 'next/navigation';

export default function SettingsIndexPage() {
  redirect(`/settings/${viewPaths.settings.account}`);
}
