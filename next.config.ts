import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // resend reaches for @react-email/render behind a dynamic import for its JSX
  // email support. We only ever send `text`, so that peer is not installed, and
  // bundling resend makes the unresolved import a build error. Left external, it
  // is required from node_modules at runtime and the branch is never taken.
  serverExternalPackages: ['resend'],
};

export default nextConfig;
