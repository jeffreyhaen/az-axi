import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Writes an `az` shim into `dir` and returns a PATH with that directory first.
 * cross-spawn resolves `az.cmd` on Windows and the extensionless script on POSIX,
 * which is exactly how the real Azure CLI is resolved.
 */
export function installShim(dir, shimPath) {
  mkdirSync(dir, { recursive: true });
  const node = process.execPath;

  const posix = join(dir, "az");
  writeFileSync(posix, `#!/bin/sh\nexec "${node}" "${shimPath}" "$@"\n`, "utf8");
  chmodSync(posix, 0o755);

  const windows = join(dir, "az.cmd");
  writeFileSync(windows, `@echo off\r\n"${node}" "${shimPath}" %*\r\n`, "utf8");

  return `${dir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
}

export function resolveRealAz() {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, ["az"], { encoding: "utf8" });
  const first = (result.stdout ?? "").split(/\r?\n/).find((line) => line.trim().length > 0);
  return first?.trim();
}
