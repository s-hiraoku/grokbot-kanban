import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // The dev badge would sit on the dock and the drawer's Save button.
  devIndicators: false,
};

export default nextConfig;
