/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 otherwise 403s its own dev chunks when the page is loaded from an
  // origin it doesn't recognise, and the page silently never hydrates.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
