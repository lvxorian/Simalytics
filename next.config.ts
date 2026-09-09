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
  async redirects() {
    return [
      // Fúze Pozic do Portfolia – staré odkazy (záložky, notifikace)
      // přesměrovat, ať se nic nerozbije
      { source: "/positions", destination: "/portfolio", permanent: true },
      { source: "/positions/new", destination: "/portfolio/new", permanent: true },
    ];
  },
};

export default nextConfig;
