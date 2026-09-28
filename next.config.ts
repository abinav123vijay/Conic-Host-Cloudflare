import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.44'],
  experimental: {
    typedRoutes: true
  }
};

export default nextConfig;
