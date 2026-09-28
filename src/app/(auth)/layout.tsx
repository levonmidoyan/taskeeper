import { AuthShell } from '@/components/brand/AuthShell';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
