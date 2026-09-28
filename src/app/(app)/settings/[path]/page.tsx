import { viewPaths } from '@better-auth-ui/core';
import { notFound } from 'next/navigation';
import { Settings } from '@/components/auth/settings/settings';

const validSettingsPaths = new Set(Object.values(viewPaths.settings));

export default async function SettingsPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (!validSettingsPaths.has(path)) notFound();

  return <Settings path={path} />;
}
