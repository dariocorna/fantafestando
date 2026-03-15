import { defineConfig, devices } from '@playwright/test';

const playwrightPort = Number(process.env.PLAYWRIGHT_PORT ?? '3000');
const baseURL = `http://127.0.0.1:${playwrightPort}`;
const emulatorStartPort = Number(process.env.PRINTER_EMULATOR_START_PORT ?? '19100');
const emulatorOutputDir = process.env.PRINTER_EMULATOR_OUTPUT_DIR ?? '/tmp/fantafestando-printer-emulator';
const webServerEnv = {
    PRINTER_CONNECT_TIMEOUT_MS: process.env.PRINTER_CONNECT_TIMEOUT_MS ?? "500",
    PRINTER_EXECUTE_TIMEOUT_MS: process.env.PRINTER_EXECUTE_TIMEOUT_MS ?? "1500",
    PRINTER_CONNECTION_RETRY_DELAY_MS: process.env.PRINTER_CONNECTION_RETRY_DELAY_MS ?? "100",
    PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS: process.env.PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS ?? "200,400,800,1200,1600",
    PRINTER_SAME_DESTINATION_COOLDOWN_MS: process.env.PRINTER_SAME_DESTINATION_COOLDOWN_MS ?? "100",
    PRINTER_EMULATOR_HOST: process.env.PRINTER_EMULATOR_HOST ?? "127.0.0.1",
    PRINTER_EMULATOR_START_PORT: String(emulatorStartPort),
    PRINTER_EMULATOR_OUTPUT_DIR: emulatorOutputDir,
};

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
    webServer: [
        {
            command: [
                `PRINTER_CONNECT_TIMEOUT_MS=${webServerEnv.PRINTER_CONNECT_TIMEOUT_MS}`,
                `PRINTER_EXECUTE_TIMEOUT_MS=${webServerEnv.PRINTER_EXECUTE_TIMEOUT_MS}`,
                `PRINTER_CONNECTION_RETRY_DELAY_MS=${webServerEnv.PRINTER_CONNECTION_RETRY_DELAY_MS}`,
                `PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS=${webServerEnv.PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS}`,
                `PRINTER_SAME_DESTINATION_COOLDOWN_MS=${webServerEnv.PRINTER_SAME_DESTINATION_COOLDOWN_MS}`,
                `PRINTER_EMULATOR_HOST=${webServerEnv.PRINTER_EMULATOR_HOST}`,
                `PRINTER_EMULATOR_START_PORT=${webServerEnv.PRINTER_EMULATOR_START_PORT}`,
                `PRINTER_EMULATOR_OUTPUT_DIR=${webServerEnv.PRINTER_EMULATOR_OUTPUT_DIR}`,
                `npx next dev --webpack --port ${playwrightPort}`
            ].join(" "),
            url: baseURL,
            reuseExistingServer: !process.env.CI,
        },
        {
            command: [
                `PRINTER_EMULATOR_START_PORT=${webServerEnv.PRINTER_EMULATOR_START_PORT}`,
                `PRINTER_EMULATOR_OUTPUT_DIR=${webServerEnv.PRINTER_EMULATOR_OUTPUT_DIR}`,
                `node scripts/printer-emulator.mjs`
            ].join(" "),
            port: emulatorStartPort,
            reuseExistingServer: !process.env.CI,
        }
    ],
});
