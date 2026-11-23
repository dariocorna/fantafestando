// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const script = path.resolve("scripts/rollback.sh");
const testEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
let repo: string;

function git(...args: string[]) {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: testEnv }).trim();
}

beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "fantafestando-rollback-"));
    mkdirSync(path.join(repo, "scripts"));
    mkdirSync(path.join(repo, "bin"));
    copyFileSync(script, path.join(repo, "scripts/rollback.sh"));
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Rollback test");
    writeFileSync(path.join(repo, "package.json"), '{"version":"1.2.0"}');
    git("add", "package.json", "scripts/rollback.sh");
    git("commit", "-qm", "target");
    git("tag", "release-target");
    writeFileSync(path.join(repo, "package.json"), '{"version":"2.0.0"}');
    git("commit", "-qam", "current release");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test.each([
    { runtime: ".env.production", wrongMenuBuild: false },
    { runtime: ".env.istanza", wrongMenuBuild: true },
])("rolls back using $runtime and checks both running surfaces", ({ runtime, wrongMenuBuild }) => {
    const selector = `APP_RUNTIME_ENV_FILE=${runtime}\n`;
    const settings = "# impostazioni sito\nCUSTOM_SETTING=valore con spazi\nBANNER='prima riga\nAPP_BUILD=contenuto testuale\nultima riga'\n";
    const stale = selector + settings + "APP_VERSION=2.0.0\nAPP_BUILD_DATE=stale";
    writeFileSync(path.join(repo, ".env.production"), runtime === ".env.production" ? stale : selector, { mode: 0o600 });
    if (runtime !== ".env.production") writeFileSync(path.join(repo, runtime), stale, { mode: 0o600 });

    const docker = `#!/usr/bin/env bash
set -eu
case "$*" in
    *' build') touch image-built ;;
    *' run --rm --no-deps -T --pull never --entrypoint node fantafestando-backoffice '*)
        test -f image-built
        while [[ "$1" != fantafestando-backoffice ]]; do shift; done
        shift
        exec "$TEST_CONTAINER_NODE" "$@"
        ;;
    *'config --environment') grep '^APP_RUNTIME_ENV_FILE=' .env.production ;;
    *'up -d'*) cp "$TEST_RUNTIME" running.env ;;
    *'exec -T'*)
        if [[ "$*" == *'fantafestando-menu'* && "$WRONG_MENU" == true ]]; then echo 'v2.0.0 (stale)'; exit 0; fi
        . <(grep -E '^APP_(VERSION|BUILD|BUILD_DATE)=[[:alnum:].-]+$' running.env)
        echo "v$APP_VERSION ($APP_BUILD - $APP_BUILD_DATE)"
        ;;
    *) exit 90 ;;
esac
`;
    writeFileSync(path.join(repo, "bin/docker"), docker, { mode: 0o755 });
    writeFileSync(path.join(repo, "bin/node"), "#!/bin/sh\necho 'Node unavailable on host' >&2\nexit 127\n", { mode: 0o755 });

    const expectedBuild = git("rev-parse", "--short", "release-target");
    const expectedDate = git("show", "-s", "--format=%cs", "release-target");
    const rollback = spawnSync("bash", ["scripts/rollback.sh", "release-target", "--skip-cleanup"], {
        cwd: repo, encoding: "utf8",
        env: { ...testEnv, PATH: path.join(repo, "bin") + path.delimiter + process.env.PATH,
            TEST_CONTAINER_NODE: process.execPath, TEST_RUNTIME: runtime, WRONG_MENU: String(wrongMenuBuild) },
    });
    expect(rollback.status, rollback.stderr).toBe(wrongMenuBuild ? 1 : 0);
    expect(git("rev-parse", "--short", "HEAD")).toBe(expectedBuild);
    if (wrongMenuBuild) expect(rollback.stderr).toContain("fantafestando-menu reports");
    const persisted = readFileSync(path.join(repo, runtime), "utf8");
    expect(persisted).toContain(settings);
    expect(persisted).toContain("APP_VERSION=1.2.0\n");
    expect(persisted).toContain(`APP_BUILD=${expectedBuild}\n`);
    expect(persisted).toContain(`APP_BUILD_DATE=${expectedDate}\n`);
    expect(statSync(path.join(repo, runtime)).mode & 0o777).toBe(0o600);
    expect(readFileSync(path.join(repo, "running.env"), "utf8")).toBe(persisted);
});
