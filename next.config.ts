import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.simcompanies.com" },
      { protocol: "https", hostname: "d1fpvcxyj8k9g1.cloudfront.net" },
      // veřejný CDN s ikonami komodit
      { protocol: "https", hostname: "jaqghnolagdxclnbcxem.supabase.co" },
    ],
  },
};

export default nextConfig;
