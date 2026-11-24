import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', timeout: 30000, fullyParallel: true, reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1440, height: 960 } },
  webServer: { command: 'npx vite --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: true, timeout: 60000 },
});
