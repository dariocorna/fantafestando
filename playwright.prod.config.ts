import { defineConfig, devices } from '@playwright/test';

const playwrightPort = Number(process.env.PLAYWRIGHT_PORT ?? '3000');
const baseURL = `http://127.0.0.1:${playwrightPort}`;

export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL,
        storageState: 'test-results/.auth/admin.json',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'Mobile Chrome',
            use: { ...devices['Pixel 5'] },
        },
    ],
    webServer: {
        command: `npm run start -- -p ${playwrightPort}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        env: {
            AUTH_TRUST_HOST: "true",
            NEXTAUTH_URL: baseURL,
        },
    },
});
