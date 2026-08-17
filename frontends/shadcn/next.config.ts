import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // A pure client: `next build` writes a static site to out/, which is what the
  // hosted cell serves. Backend and hub URLs are baked in at build time via
  // NEXT_PUBLIC_BACKEND_URL / NEXT_PUBLIC_INDEX_URL — see scripts/hosted.sh.
  output: "export",
}

export default nextConfig
