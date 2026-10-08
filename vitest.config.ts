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
  // Each runtime suite starts workerd/D1. Bound the number of these processes
  // instead of making timing-sensitive tests compete with every CPU core.
  test: { include: ['tests/**/*.test.ts'], maxWorkers: 4 },
});
