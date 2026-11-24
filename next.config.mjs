/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: '/', destination: '/app.html' }];
  },
};

export default nextConfig;
