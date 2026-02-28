import packageJson from "../../package.json";

function readEnv(key: string): string | null {
    const value = process.env[key];
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function getAppVersion(): string {
    return readEnv("APP_VERSION") || packageJson.version;
}

export function getAppVersionLabel(): string {
    const version = getAppVersion();
    const build = readEnv("APP_BUILD");
    const buildDate = readEnv("APP_BUILD_DATE");

    let label = `v${version}`;

    if (build || buildDate) {
        const parts = [];
        if (build) parts.push(build);
        if (buildDate) parts.push(buildDate);
        label += ` (${parts.join(" - ")})`;
    }

    return label;
}

export function getAppReleaseKey(): string {
    return readEnv("APP_BUILD") || getAppVersion();
}
