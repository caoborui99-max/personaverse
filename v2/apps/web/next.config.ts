import type { NextConfig } from 'next';
const upstream = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4311';
const config: NextConfig = {
  poweredByHeader: false,
  experimental: { useTypeScriptCli: false },
  transpilePackages: ['@pv/shared', '@pv/api-client'],
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${upstream}/api/v1/:path*` }];
  },
};
export default config;
