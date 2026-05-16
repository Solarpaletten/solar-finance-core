/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Sprint 7 dev mode: proxy /api/* requests to FastAPI on :8000.
  // This sidesteps CORS entirely for local development. In Sprint 7.1
  // (Docker integration), CORS middleware will be added to FastAPI
  // and the frontend will talk to api directly via the docker network.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
