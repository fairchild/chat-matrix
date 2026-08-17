/** @type {import('next').NextConfig} */
// STATIC_EXPORT=1 builds the hosted shape: the page as a static site in out/,
// with app/api/copilotkit left out (a POST route can't be exported — the hosted
// Worker in worker/ provides it instead). Route files are `.ts`; pages are
// `.tsx`, so narrowing pageExtensions is what drops the route from the build.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig = {
  ...(staticExport ? { output: "export", pageExtensions: ["tsx"] } : {}),
  // Next 16 otherwise 403s its own dev chunks when the page is loaded from an
  // origin it doesn't recognise, and the page silently never hydrates.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
