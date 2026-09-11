import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { parseAppConfig } from './src/app/parseAppConfig.ts';
import { DEV_SERVER_PORT, PREVIEW_SERVER_PORT } from './tooling/ports.ts';

const CLIENT_ENV_PREFIX = 'VITE_';
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (character) => HTML_ESCAPES[character]);
}

function htmlTitle(title: string): Plugin {
  return {
    name: 'html-title',
    transformIndexHtml: () => [{ tag: 'title', children: escapeHtml(title), injectTo: 'head' }],
  };
}

export default defineConfig(({ mode }) => {
  const { appTitle } = parseAppConfig(loadEnv(mode, process.cwd(), CLIENT_ENV_PREFIX));

  return {
    plugins: [react(), tailwindcss(), htmlTitle(appTitle)],
    server: {
      port: DEV_SERVER_PORT,
      strictPort: true,
    },
    preview: {
      port: PREVIEW_SERVER_PORT,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'tooling/**/*.test.ts'],
    },
  };
});
