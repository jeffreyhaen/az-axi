#!/usr/bin/env node
/**
 * Stand-in for the Azure CLI, placed first on PATH while the benchmark runs.
 *
 *   record  — forwards to the real `az`, stores the call, and passes the output through
 *   replay  — answers from the recorded fixture, never touches the network
 *
 * Because the shim sits on PATH, the shipped `az-axi` binary runs completely
 * unmodified: no benchmark code paths, no test seams, no special casing.
 */
import { appendFileSync, readFileSync } from "node:fs";
import spawn from "cross-spawn";

const args = process.argv.slice(2);
const mode = process.env.AZ_AXI_BENCH_MODE;
const fixture = process.env.AZ_AXI_BENCH_FIXTURE;

if (!fixture) {
  console.error("az-shim: AZ_AXI_BENCH_FIXTURE is not set");
  process.exit(2);
}

if (mode === "record") {
  const real = process.env.AZ_AXI_BENCH_REAL_AZ;
  if (!real) {
    console.error("az-shim: AZ_AXI_BENCH_REAL_AZ is not set");
    process.exit(2);
  }
  const result = spawn.sync(real, args, { encoding: "utf8", env: process.env, maxBuffer: 512 * 1024 * 1024 });
  const call = {
    args,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 0,
  };
  appendFileSync(fixture, `${JSON.stringify(call)}\n`, "utf8");
  if (call.stdout) process.stdout.write(call.stdout);
  if (call.stderr) process.stderr.write(call.stderr);
  process.exit(call.exitCode);
}

if (mode === "replay") {
  const calls = readFileSync(fixture, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const key = JSON.stringify(args);
  const call = calls.find((entry) => JSON.stringify(entry.args) === key) ?? calls.shift();
  if (!call) {
    console.error(`az-shim: no recorded call for ${args.join(" ")}`);
    process.exit(2);
  }
  if (call.stdout) process.stdout.write(call.stdout);
  if (call.stderr) process.stderr.write(call.stderr);
  process.exit(call.exitCode ?? 0);
}

console.error(`az-shim: unknown mode ${mode ?? "(unset)"}`);
process.exit(2);
