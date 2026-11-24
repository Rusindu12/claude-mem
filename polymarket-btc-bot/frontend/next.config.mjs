/** @type {import('next').NextConfig} */
const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${backendUrl}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
