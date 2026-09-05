import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? '/soft-matter-jelly-lab/' : '/',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    vinext(),
    ...(process.env.GITHUB_ACTIONS === 'true' ? [] : [sites()]),
  ],
  server: { host: '0.0.0.0' },
});
