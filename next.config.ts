import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit and prisma are CommonJS — must stay on the server bundle
  serverExternalPackages: ["pdfkit", "@prisma/client", "prisma"],
};

export default nextConfig;
