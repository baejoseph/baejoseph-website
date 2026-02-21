import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// Vite plugin: normalize non-ASCII chars in dev server URLs to lowercase percent-encoding
// This fixes Korean slugs like /용기/ being received as literal chars instead of %ec%9a%a9%ea%b8%b0
const unicodeUrlNormalizer = {
  name: 'unicode-url-normalizer',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /[^\x00-\x7F]/.test(req.url)) {
        req.url = req.url.replace(/[^\x00-\x7F]/g,
          c => encodeURIComponent(c).toLowerCase()
        );
      }
      next();
    });
  },
};

export default defineConfig({
  integrations: [mdx()],
  site: 'https://baejoseph.com',
  trailingSlash: 'ignore',
  vite: {
    plugins: [unicodeUrlNormalizer],
  },
});
