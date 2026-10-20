import type { NextConfig } from "next";

// The legal pages live once, in the app (app.bookalyze.com/privacy-policy is the address given to
// the marketplaces); the public site sends its own addresses there.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.bookalyze.com";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/privacy", destination: `${APP_URL}/privacy-policy`, permanent: false },
      { source: "/privacy-policy", destination: `${APP_URL}/privacy-policy`, permanent: false },
      { source: "/terms", destination: `${APP_URL}/terms`, permanent: false },
      { source: "/sign-in", destination: `${APP_URL}/sign-in`, permanent: false },
      { source: "/sign-up", destination: `${APP_URL}/sign-up`, permanent: false },
    ];
  },
};

export default nextConfig;
