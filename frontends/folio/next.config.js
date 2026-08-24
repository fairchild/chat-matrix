/** @type {import('next').NextConfig} */
const nextConfig = {
  // A pure client: `next build` writes a static site to out/, which is what the
  // hosted cell serves. Backend and hub URLs are baked in at build time via
  // NEXT_PUBLIC_BACKEND_URL / NEXT_PUBLIC_INDEX_URL — see scripts/hosted.sh.
  output: "export",
  // Next 16 otherwise 403s its own dev chunks when the page is loaded from an
  // origin it doesn't recognise, and the page silently never hydrates.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
