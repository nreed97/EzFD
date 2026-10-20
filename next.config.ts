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
  // Sent by the app itself rather than by nginx or Caddy, so both installs
  // (and anyone running `node server.js` behind their own proxy) get them.
  //
  // The join code is in every event URL and is the only credential an event
  // has, so no Referer may carry it to another site. Nothing here is meant to
  // be framed — the CW window is a popup, not an iframe — and framing is how a
  // page gets clicked on by a page that is not it. A Permissions-Policy is
  // deliberately absent: Web Serial rig control needs `serial`, and listing
  // features to allow is a list that silently breaks the next one added.
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      ],
    }];
  },
  outputFileTracingIncludes: {
    '/docs': ['./docs/**/*'],
    '/docs/[slug]': ['./docs/**/*'],
    '/docs/images/[file]': ['./docs/images/**/*'],
  },
};

export default nextConfig;
