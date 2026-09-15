import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/", destination: "/map", permanent: false }];
  },
};

export default nextConfig;
