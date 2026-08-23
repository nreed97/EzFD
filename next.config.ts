import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // The docs routes read docs/*.md and docs/images/* at request time. Next's
  // file tracing already picks them up from the directory read in lib/docs.ts,
  // so this is belt and braces rather than load-bearing — verified by building
  // without it. It is kept because the failure mode is invisible in dev: the
  // files are simply there locally, and a tracing change would only show up as
  // an empty /docs on a deployed server. scripts/test-e2e.sh runs against the
  // standalone bundle and asserts the guides render, which is the real guard.
  outputFileTracingIncludes: {
    '/docs': ['./docs/**/*'],
    '/docs/[slug]': ['./docs/**/*'],
    '/docs/images/[file]': ['./docs/images/**/*'],
  },
};

export default nextConfig;
