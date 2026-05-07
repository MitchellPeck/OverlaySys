/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are TS source — let Next compile them.
  transpilePackages: [
    "@overlaysys/core",
    "@overlaysys/ws-protocol",
    "@overlaysys/template-engine",
    "@overlaysys/editor-kit",
  ],
  // Static export for Electron packaging. The whole operator UI is
  // client-rendered (every page has "use client") and talks to the
  // server over WebSocket, so SSR/server actions/API routes are never
  // needed. The exported HTML+JS is served by Fastify under /operator/
  // in production; basePath ensures all asset URLs and Link hrefs are
  // emitted with that prefix.
  output: process.env.NEXT_BUILD_STATIC === "1" ? "export" : undefined,
  basePath: process.env.NEXT_BUILD_STATIC === "1" ? "/operator" : "",
  assetPrefix: process.env.NEXT_BUILD_STATIC === "1" ? "/operator" : undefined,
  // Static-export needs trailingSlash so internal routes resolve as
  // foo/index.html instead of foo.html. Doesn't affect dev mode.
  trailingSlash: process.env.NEXT_BUILD_STATIC === "1",
  // Disable next/image optimization — the static export can't run it.
  images: { unoptimized: true },
};
export default nextConfig;
