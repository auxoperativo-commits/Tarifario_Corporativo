/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Ignora los errores de TypeScript al compilar en Vercel
    ignoreBuildErrors: true,
  },
  eslint: {
    // Evita también que fallas de ESLint detengan la compilación
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;