#!/usr/bin/env node
/**
 * Records the Azure CLI traffic behind every benchmark scenario.
 *
 *   node scripts/benchmark/capture.mjs [--only <id>]
 *
 * Runs the built `az-axi` against your own subscription with a recording shim on
 * PATH. The recordings contain your tenant's data, so they stay local:
 * benchmark/fixtures/ and benchmark/targets.json are git-ignored.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "../../benchmark/scenarios.mjs";
import { installShim, resolveRealAz } from "./shim.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(root, "dist", "bin", "az-axi.js");
const fixturesDir = join(root, "benchmark", "fixtures");
const shimSource = join(root, "scripts", "benchmark", "az-shim.mjs");
const targetsPath = join(root, "benchmark", "targets.json");

const only = flag("--only");

if (!existsSync(cli)) {
  console.error("dist/bin/az-axi.js not found — run `pnpm run build` first");
  process.exit(2);
}

const realAz = resolveRealAz();
if (!realAz) {
  console.error("az not found on PATH — install the Azure CLI and run `az login`");
  process.exit(2);
}

const targets = existsSync(targetsPath) ? JSON.parse(readFileSync(targetsPath, "utf8")) : {};

mkdirSync(fixturesDir, { recursive: true });
const shimDir = join(root, "benchmark", ".shim");
const path = installShim(shimDir, shimSource);

let recorded = 0;
let skipped = 0;

for (const scenario of SCENARIOS) {
  if (only && scenario.id !== only) continue;

  const argv = fill(scenario.argv, targets);
  if (!argv) {
    skipped += 1;
    console.log(`skip  ${scenario.id} — targets.json misses ${missing(scenario.argv, targets)}`);
    continue;
  }

  const fixture = join(fixturesDir, `${scenario.id}.jsonl`);
  rmSync(fixture, { force: true });
  writeFileSync(fixture, "", "utf8");

  const result = spawnSync(process.execPath, [cli, ...argv], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: path,
      Path: path,
      AZ_AXI_BENCH_MODE: "record",
      AZ_AXI_BENCH_FIXTURE: fixture,
      AZ_AXI_BENCH_REAL_AZ: realAz,
    },
  });

  const recordedCalls = readFileSync(fixture, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const calls = recordedCalls.length;
  if (result.status !== 0 || calls === 0) {
    rmSync(fixture, { force: true });
    skipped += 1;
    const reason = (result.stdout || result.stderr || "").trim().split("\n")[0] ?? "no output";
    console.log(`skip  ${scenario.id} — ${reason}`);
    continue;
  }

  if (recordedCalls.every((call) => isEmptyPayload(call.stdout))) {
    rmSync(fixture, { force: true });
    skipped += 1;
    console.log(`skip  ${scenario.id} — empty result, nothing to compare`);
    continue;
  }

  writeFileSync(
    join(fixturesDir, `${scenario.id}.meta.json`),
    `${JSON.stringify({ scenario: scenario.id, argv }, null, 2)}\n`,
    "utf8",
  );

  recorded += 1;
  console.log(`ok    ${scenario.id} (${calls} az call${calls === 1 ? "" : "s"})`);
}

rmSync(shimDir, { recursive: true, force: true });

console.log(`\n${recorded} scenario(s) recorded, ${skipped} skipped.`);
console.log("Fixtures stay local (benchmark/fixtures is git-ignored). Run `pnpm run bench` next.");

function fill(argv, values) {
  const out = [];
  for (const arg of argv) {
    const match = /^\{(\w+)\}$/.exec(arg);
    if (!match) {
      out.push(arg);
      continue;
    }
    const value = values[match[1]];
    if (!value) return undefined;
    out.push(String(value));
  }
  return out;
}

function missing(argv, values) {
  return argv
    .map((arg) => /^\{(\w+)\}$/.exec(arg)?.[1])
    .filter((name) => name && !values[name])
    .join(", ");
}

function isEmptyPayload(stdout) {
  try {
    const value = JSON.parse(stdout);
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === undefined;
  } catch {
    return !stdout.trim();
  }
}

function flag(name) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : undefined;
}
