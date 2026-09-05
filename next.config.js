/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/asset": ["./data/nexo_macro.csv"],
    "/api/health": [
      "./data/nexo_macro.csv",
      "./data/context/latest.json",
    ],
    "/api/analyze": ["./data/context/latest.json"],
    "/api/nmi/context/latest": ["./data/context/latest.json"],
    "/api/export/pdf": ["./node_modules/pdfkit/js/data/*.afm"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
