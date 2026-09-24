import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Funds used to live under /clients/…, when the schema called a fund a
   * client. Links to them were shared — in demos, in notices' "open this call"
   * pointers, in bookmarks — so the old paths forward to the new ones, query
   * string and all.
   *
   * Temporary (307), not permanent (308), on purpose: a 308 is cached by the
   * browser for good, and if the rename ever has to be rolled back, every
   * cached redirect would send people to a path that no longer exists. Make it
   * permanent once the rename has been live long enough to trust.
   */
  async redirects() {
    return [
      { source: '/clients/:path*', destination: '/funds/:path*', permanent: false },
    ];
  },
};

export default nextConfig;
