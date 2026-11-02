const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";

/** Browser calls stay same-origin, so the session cookie and API keys never cross to the client. */
export default {
  // Lets the dev server work when opened via the LAN address Next.js prints, not just localhost.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
