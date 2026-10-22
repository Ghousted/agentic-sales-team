/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lint runs on its own (`pnpm lint`); keep it from gating deploys.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
