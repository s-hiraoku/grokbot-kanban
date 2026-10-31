import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The verify-kanban skill builds into its own folder so it can run beside `next dev` and the e2e tests.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@electric-sql/pglite"],
  // The dev badge would sit on the dock and the drawer's Save button.
  devIndicators: false,
};

export default nextConfig;
