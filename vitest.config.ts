import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL as NodeURL } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new NodeURL('./tests/fixtures/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
