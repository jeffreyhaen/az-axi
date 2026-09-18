import spawn from "cross-spawn";
import { spawnSync } from "node:child_process";
import { AxiError } from "axi-sdk-js";

const MAX_BUFFER_BYTES = 48 * 1024 * 1024;

export interface AzResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface AzStreamOptions {
  /** Stop after this many milliseconds. */
  forMs: number;
  /** Stop after this many lines. */
  maxLines: number;
}

export interface AzStreamResult {
  lines: string[];
  /** Why the capture ended: the window closed, the line budget ran out, or az exited. */
  stoppedBy: "window" | "limit" | "exit";
  stderr: string;
  exitCode: number | undefined;
}

export type AzRunner = (args: string[]) => Promise<AzResult>;
export type AzStreamer = (
  args: string[],
  options: AzStreamOptions,
) => Promise<AzStreamResult>;

let runner: AzRunner = defaultRunner;
let streamer: AzStreamer = defaultStreamer;

/** Test seam: replace the process launcher. */
export function setAzRunner(next: AzRunner): void {
  runner = next;
}

export function resetAzRunner(): void {
  runner = defaultRunner;
}

/** Test seam: replace the streaming launcher. */
export function setAzStreamer(next: AzStreamer): void {
  streamer = next;
}

export function resetAzStreamer(): void {
  streamer = defaultStreamer;
}

const AZ_ENV = {
  AZURE_CORE_COLLECT_TELEMETRY: "no",
  AZURE_CORE_ONLY_SHOW_ERRORS: "true",
  AZURE_CORE_DISABLE_CONFIRM_PROMPT: "1",
  AZURE_CORE_NO_COLOR: "true",
};

/**
 * Azure CLI ships as `az.cmd` on Windows, which `child_process.execFile` refuses
 * to launch. `cross-spawn` resolves the platform's real executable, so command
 * resolution stays in the spawn layer instead of leaking Windows branches here.
 */
function defaultRunner(args: string[]): Promise<AzResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("az", args, {
      env: { ...process.env, ...AZ_ENV },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let overflowed = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length + chunk.length > MAX_BUFFER_BYTES) {
        overflowed = true;
        killTree(child);
        return;
      }
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(azNotInstalledError());
        return;
      }
      reject(
        new AxiError(`failed to run az: ${error.message}`, "AZ_SPAWN_FAILED"),
      );
    });

    child.on("close", (code) => {
      if (overflowed) {
        reject(
          new AxiError(
            "az returned more output than az-axi can buffer",
            "OUTPUT_TOO_LARGE",
            [
              "Narrow the query with --limit, --fields, or an az filter such as --query",
            ],
          ),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

/**
 * `child.kill()` signals the launcher, not the process tree. On Windows `az` is
 * a batch file wrapping python, so the signal never reaches the process that
 * holds the log socket. The kill has to be synchronous: az-axi exits as soon as
 * it resolves, and an async taskkill would never get to run.
 */
function killTree(child: {
  pid?: number;
  kill: (signal?: NodeJS.Signals) => boolean;
}): void {
  const pid = child.pid;
  if (pid !== undefined && process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      /* fall through to the signal below */
    }
  }
  try {
    child.kill();
  } catch {
    /* the child is already gone */
  }
}

/**
 * Streaming commands (`log tail`, `--follow`) never exit on their own. Instead
 * of buffering to completion, capture a bounded window and kill the child, so
 * an agent always gets an answer that says how much was seen.
 *
 * Two az quirks decide the shape of this: the log stream is written to stderr
 * as `WARNING:` lines, not stdout, and `--only-show-errors` suppresses the
 * stream entirely. Both streams are therefore read as content, and the
 * only-show-errors switch is off for the duration of a capture.
 */
export type SpawnLike = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => ReturnType<typeof spawn>;

function defaultStreamer(
  args: string[],
  options: AzStreamOptions,
): Promise<AzStreamResult> {
  return makeStreamer(spawn as SpawnLike)(args, options);
}

/** Exported for tests: the streamer with an injectable process launcher. */
export function makeStreamer(launch: SpawnLike): AzStreamer {
  return (args: string[], options: AzStreamOptions) =>
    new Promise((resolve, reject) => {
      const child = launch("az", args, {
        env: {
          ...process.env,
          ...AZ_ENV,
          AZURE_CORE_ONLY_SHOW_ERRORS: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const lines: string[] = [];
      const errors: string[] = [];
      const pending = { stdout: "", stderr: "" };
      let stoppedBy: AzStreamResult["stoppedBy"] = "exit";
      let settled = false;

      /**
       * Resolving is not allowed to depend on the child dying: a stream that
       * ignores the kill would hang az-axi forever, which is the failure this
       * whole path exists to prevent.
       */
      const finish = (exitCode: number | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        killTree(child);
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref?.();
        for (const rest of [pending.stdout, pending.stderr]) {
          if (rest.trim().length > 0 && lines.length < options.maxLines)
            take(rest);
        }
        resolve({ lines, stoppedBy, stderr: errors.join("\n"), exitCode });
      };

      const timer = setTimeout(() => {
        stoppedBy = "window";
        finish(undefined);
      }, options.forMs);
      timer.unref?.();

      /** az prefixes streamed lines with `WARNING:`; real failures use `ERROR:`. */
      const take = (raw: string): boolean => {
        const line = raw.replace(/^WARNING:\s*/, "").trimEnd();
        if (line.trim().length === 0) return false;
        if (/^ERROR:/.test(line)) {
          errors.push(line.replace(/^ERROR:\s*/, ""));
          return false;
        }
        lines.push(line);
        return lines.length >= options.maxLines;
      };

      const consume = (which: "stdout" | "stderr") => (chunk: string) => {
        pending[which] += chunk;
        const parts = pending[which].split(/\r?\n/);
        pending[which] = parts.pop() ?? "";
        for (const part of parts) {
          if (take(part)) {
            stoppedBy = "limit";
            finish(undefined);
            return;
          }
        }
      };

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", consume("stdout"));
      child.stderr?.on("data", consume("stderr"));

      child.on("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (error.code === "ENOENT") {
          reject(azNotInstalledError());
          return;
        }
        reject(
          new AxiError(`failed to run az: ${error.message}`, "AZ_SPAWN_FAILED"),
        );
      });

      child.on("close", (code) => finish(code ?? undefined));
    });
}

export function azNotInstalledError(): AxiError {
  return new AxiError(
    "Azure CLI (`az`) is not installed or not on PATH",
    "AZ_NOT_INSTALLED",
    [
      "Install it: https://learn.microsoft.com/cli/azure/install-azure-cli",
      "Then run `az login` in a human terminal",
      "Run `az-axi doctor` to re-check",
    ],
  );
}

/** Run az and return the raw result, without interpreting the exit code. */
export async function azRaw(args: string[]): Promise<AzResult> {
  return runner(args);
}

/** Capture a bounded window of a streaming az command. */
export async function azStream(
  args: string[],
  options: AzStreamOptions,
): Promise<AzStreamResult> {
  return streamer(stripOutputFlags(args), options);
}

/** Run az with `--output json` and parse the result. */
export async function azJson<T = unknown>(
  args: string[],
): Promise<T | undefined> {
  const result = await azRaw([
    ...stripOutputFlags(args),
    "--output",
    "json",
    "--only-show-errors",
  ]);
  if (result.exitCode !== 0) {
    throw mapAzError(
      [result.stderr, result.stdout].filter(Boolean).join("\n").trim(),
      result.exitCode,
    );
  }
  const text = result.stdout.trim();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AxiError(
      `az returned output that is not JSON: ${text.slice(0, 200)}`,
      "UNEXPECTED_OUTPUT",
      ["Retry with --raw to read the unparsed az output"],
    );
  }
}

/** Run az and return stdout as text (used for `--help` style commands). */
export async function azText(args: string[]): Promise<string> {
  const result = await azRaw([...stripOutputFlags(args), "--only-show-errors"]);
  if (result.exitCode !== 0) {
    throw mapAzError(
      [result.stderr, result.stdout].filter(Boolean).join("\n").trim(),
      result.exitCode,
    );
  }
  return result.stdout;
}

/** az-axi owns the output format; caller-supplied output flags are dropped. */
export function stripOutputFlags(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-o" || arg === "--output") {
      index += 1;
      continue;
    }
    if (arg === "--only-show-errors") continue;
    if (arg.startsWith("-o=") || arg.startsWith("--output=")) continue;
    out.push(arg);
  }
  return out;
}

const NOT_LOGGED_IN =
  /(az login)|(Please run 'az login')|(No subscription found)|(AADSTS)|(refresh token has expired)/i;
const NOT_FOUND =
  /(ResourceNotFound)|(was not found)|(could not be found)|(NotFound)/i;
const FORBIDDEN =
  /(AuthorizationFailed)|(does not have authorization)|(Forbidden)|(InsufficientPrivileges)/i;
const UNKNOWN_COMMAND =
  /(is not in the '.*' command group)|(unrecognized arguments)|(invalid choice)|(not an az command)|(is misspelled or not recognized)|(are misspelled or not recognized)/i;
const EXTENSION_MISSING =
  /(is not installed)|(extension is not installed)|(The command requires the extension)/i;

/** Map az stderr onto an AXI error code with actionable next steps. */
export function mapAzError(message: string, exitCode: number): AxiError {
  const text = message || `az exited with code ${exitCode}`;
  if (NOT_LOGGED_IN.test(text)) {
    return new AxiError(firstLine(text), "AUTH_REQUIRED", [
      "Run `az login` in a human terminal (az-axi never prompts)",
      "Run `az-axi doctor` to confirm the active subscription",
    ]);
  }
  if (EXTENSION_MISSING.test(text)) {
    return new AxiError(firstLine(text), "EXTENSION_REQUIRED", [
      "Install the extension with `az extension add --name <name>`",
      "Run `az-axi doctor` to list installed extensions",
    ]);
  }
  if (UNKNOWN_COMMAND.test(text)) {
    return new AxiError(firstLine(text), "VALIDATION_ERROR", [
      "Run `az-axi find <text>` to search available command groups",
      "Run `az-axi <group> --help` for the exact syntax",
    ]);
  }
  if (FORBIDDEN.test(text)) {
    return new AxiError(firstLine(text), "FORBIDDEN", [
      "Check the role assignment for the signed-in identity",
      "Run `az-axi doctor` to see which account and subscription are active",
    ]);
  }
  if (NOT_FOUND.test(text)) {
    return new AxiError(firstLine(text), "NOT_FOUND", [
      "Verify the name, resource group, and subscription",
      "Run `az-axi group list` or `az-axi resource list -g <group>`",
    ]);
  }
  return new AxiError(firstLine(text), "AZ_ERROR");
}

function firstLine(text: string): string {
  const cleaned = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^ERROR:\s*/, "").trim())
    .filter(Boolean);
  return cleaned.slice(0, 3).join(" ") || "az failed";
}
