// Keep the service entrypoint beside package.json so Vercel traces this service's
// dependencies and preserves the source-relative certificate and font assets.
export { default } from './src/vercel.js';
