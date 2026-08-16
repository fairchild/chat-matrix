import { withAui } from "@assistant-ui/next";
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@assistant-ui/react", "@assistant-ui/react-ai-sdk"],
  // Next 16 refuses to serve dev chunks to an origin it doesn't recognise, which
  // shows up as 403s on /_next/static/* and a page that never hydrates.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default withAui(nextConfig);
