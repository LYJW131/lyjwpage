import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp 是原生模块，被打进 Server Components 包里会加载失败
  serverExternalPackages: ["sharp"],
  allowedDevOrigins: ["test.lyjw.dev"],
};

export default nextConfig;
