import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdfkit", "@prisma/client", "prisma"],
  },
};

export default nextConfig;
