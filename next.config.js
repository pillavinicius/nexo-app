/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/asset": ["./data/nexo_macro.csv"],
  },
};
module.exports = nextConfig;
