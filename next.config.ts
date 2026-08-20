//created by kinjal
import type { NextConfig } from "next";

/**
 * The interface reads committed snapshots, so it renders with nothing running.
 * Adding a game is the exception: it needs the Python side, which downloads
 * events, fits a completion model and cuts footage.
 *
 * Proxied rather than called across origins so the browser sees one host. The
 * upload is gigabytes and a preflight on a cross-origin multipart POST is a
 * cost with nothing to show for it.
 */
const API = process.env.PEPTALK_API ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  experimental: {
    // Next buffers a proxied request body in memory and caps it at 10MB by
    // DEFAULT — and past the cap it does not fail. It truncates the body,
    // logs a warning, and lets the request through, so a recording would
    // arrive at the service as a broken file with no error anywhere the
    // coach can see.
    //
    // The upload itself does not come through here: `src/lib/games.ts` posts
    // the file straight to the service, because buffering gigabytes in the
    // dev server's memory to hand them to a process on the same machine is
    // pointless. This limit covers the small JSON and form posts that DO
    // proxy, with enough room that nothing is ever silently truncated.
    proxyClientMaxBodySize: "64mb",
  },
  async rewrites() {
    return [{ source: "/api/py/:path*", destination: `${API}/api/:path*` }];
  },
};

export default nextConfig;
