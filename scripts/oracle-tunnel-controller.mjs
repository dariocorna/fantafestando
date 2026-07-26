#!/usr/bin/env node

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEFAULT_REMOTE_ACCESS = Object.freeze({
  menuEnabled: true,
  adminEnabled: false,
  posEnabled: false,
  sshEnabled: false,
});

const SURFACES = [
  ["menuEnabled", "ORACLE_TUNNEL_REMOTE_PORT", "3302", "ORACLE_TUNNEL_LOCAL_HOST", "fantafestando-menu", "ORACLE_TUNNEL_LOCAL_PORT", "3000"],
  ["adminEnabled", "ORACLE_TUNNEL_ADMIN_REMOTE_PORT", "3304", "ORACLE_TUNNEL_ADMIN_LOCAL_HOST", "fantafestando-backoffice", "ORACLE_TUNNEL_ADMIN_LOCAL_PORT", "3000"],
  ["posEnabled", "ORACLE_TUNNEL_POS_REMOTE_PORT", "3305", "ORACLE_TUNNEL_POS_LOCAL_HOST", "fantafestando-backoffice", "ORACLE_TUNNEL_POS_LOCAL_PORT", "3000"],
  ["sshEnabled", "ORACLE_TUNNEL_SSH_REMOTE_PORT", "3322", "ORACLE_TUNNEL_SSH_LOCAL_HOST", "host.docker.internal", "ORACLE_TUNNEL_SSH_LOCAL_PORT", "22"],
];

export function normalizeRemoteAccess(value) {
  return Object.fromEntries(
    Object.keys(DEFAULT_REMOTE_ACCESS).map((key) => [
      key,
      typeof value?.[key] === "boolean" ? value[key] : DEFAULT_REMOTE_ACCESS[key],
    ])
  );
}

export function buildRemoteSpecs(config, env = process.env) {
  const normalized = normalizeRemoteAccess(config);
  const bindAddress = env.ORACLE_TUNNEL_REMOTE_BIND_ADDRESS || "127.0.0.1";
  return SURFACES
    .filter(([key]) => normalized[key])
    .map(([, remoteKey, remoteDefault, localHostKey, localHostDefault, localPortKey, localPortDefault]) =>
      `${bindAddress}:${env[remoteKey] || remoteDefault}:${env[localHostKey] || localHostDefault}:${env[localPortKey] || localPortDefault}`
    );
}

export function buildSshArgs(remoteSpecs, env = process.env) {
  const args = [
    "-N",
    "-T",
    "-o", "ExitOnForwardFailure=yes",
    "-o", `ServerAliveInterval=${env.ORACLE_TUNNEL_SERVER_ALIVE_INTERVAL || "30"}`,
    "-o", `ServerAliveCountMax=${env.ORACLE_TUNNEL_SERVER_ALIVE_COUNT_MAX || "3"}`,
    // Pin the server: the container has no persistent known_hosts, so
    // "accept-new" would silently re-trust a new key on every restart.
    "-o", `StrictHostKeyChecking=${env.ORACLE_TUNNEL_STRICT_HOST_KEY_CHECKING || "yes"}`,
    "-o", `UserKnownHostsFile=${env.ORACLE_TUNNEL_KNOWN_HOSTS_PATH || "/run/oracle-tunnel/known_hosts"}`,
  ];
  if (env.ORACLE_TUNNEL_KEY_PATH) args.push("-i", env.ORACLE_TUNNEL_KEY_PATH);
  for (const spec of remoteSpecs) args.push("-R", spec);
  args.push(`${env.ORACLE_TUNNEL_USER}@${env.ORACLE_TUNNEL_HOST}`);
  return args;
}

function validateEnvironment(env) {
  for (const key of ["ORACLE_TUNNEL_HOST", "ORACLE_TUNNEL_USER", "ORACLE_TUNNEL_CONTROL_URL", "ORACLE_TUNNEL_CONTROL_TOKEN"]) {
    if (!env[key]?.trim()) throw new Error(`Missing ${key}`);
  }
}

function controllerHeaders(env) {
  return {
    authorization: `Bearer ${env.ORACLE_TUNNEL_CONTROL_TOKEN}`,
    "content-type": "application/json",
  };
}

async function fetchDesiredConfig(env) {
  const response = await fetch(env.ORACLE_TUNNEL_CONTROL_URL, {
    headers: controllerHeaders(env),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Controller API GET failed (${response.status})`);
  return normalizeRemoteAccess(await response.json());
}

async function reportStatus(config, error, env) {
  const response = await fetch(env.ORACLE_TUNNEL_CONTROL_URL, {
    method: "POST",
    headers: controllerHeaders(env),
    body: JSON.stringify({ ...config, ...(error ? { error: String(error).slice(0, 500) } : {}) }),
  });
  if (!response.ok) throw new Error(`Controller API POST failed (${response.status})`);
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export async function runController(env = process.env) {
  validateEnvironment(env);
  const pollMs = Math.max(1000, Number(env.ORACLE_TUNNEL_CONTROL_POLL_MS || 5000));
  let child = null;
  let currentKey = "";
  let desired = DEFAULT_REMOTE_ACCESS;
  let stopping = false;

  async function apply(config) {
    const specs = buildRemoteSpecs(config, env);
    const nextKey = JSON.stringify(specs);
    if (nextKey === currentKey && child?.exitCode === null) return;

    await stopChild(child);
    child = null;
    currentKey = "";

    if (specs.length === 0) {
      await reportStatus(config, null, env);
      return;
    }

    child = spawn(env.ORACLE_TUNNEL_SSH_BIN || "ssh", buildSshArgs(specs, env), { stdio: "inherit" });
    await waitForSpawn(child);
    currentKey = nextKey;
    await reportStatus(config, null, env);

    child.once("exit", (code, signal) => {
      if (stopping) return;
      currentKey = "";
      const disabled = Object.fromEntries(Object.keys(DEFAULT_REMOTE_ACCESS).map((key) => [key, false]));
      reportStatus(disabled, `SSH tunnel stopped (${signal || code || "unknown"})`, env).catch((error) =>
        process.stderr.write(`${error.message}\n`)
      );
    });
  }

  const shutdown = async () => {
    stopping = true;
    await stopChild(child);
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  await apply(desired);
  while (!stopping) {
    try {
      desired = await fetchDesiredConfig(env);
      await apply(desired);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runController().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
