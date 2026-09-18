import spawn from "cross-spawn";
import { AxiError } from "axi-sdk-js";

const MAX_BUFFER_BYTES = 48 * 1024 * 1024;

export interface AzResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type AzRunner = (args: string[]) => Promise<AzResult>;

let runner: AzRunner = defaultRunner;

/** Test seam: replace the process launcher. */
export function setAzRunner(next: AzRunner): void {
  runner = next;
}

export function resetAzRunner(): void {
  runner = defaultRunner;
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
        child.kill();
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
      reject(new AxiError(`failed to run az: ${error.message}`, "AZ_SPAWN_FAILED"));
    });

    child.on("close", (code) => {
      if (overflowed) {
        reject(
          new AxiError("az returned more output than az-axi can buffer", "OUTPUT_TOO_LARGE", [
            "Narrow the query with --limit, --fields, or an az filter such as --query",
          ]),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

export function azNotInstalledError(): AxiError {
  return new AxiError("Azure CLI (`az`) is not installed or not on PATH", "AZ_NOT_INSTALLED", [
    "Install it: https://learn.microsoft.com/cli/azure/install-azure-cli",
    "Then run `az login` in a human terminal",
    "Run `az-axi doctor` to re-check",
  ]);
}

/** Run az and return the raw result, without interpreting the exit code. */
export async function azRaw(args: string[]): Promise<AzResult> {
  return runner(args);
}

/** Run az with `--output json` and parse the result. */
export async function azJson<T = unknown>(args: string[]): Promise<T | undefined> {
  const result = await azRaw([...stripOutputFlags(args), "--output", "json", "--only-show-errors"]);
  if (result.exitCode !== 0) {
    throw mapAzError([result.stderr, result.stdout].filter(Boolean).join("\n").trim(), result.exitCode);
  }
  const text = result.stdout.trim();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AxiError(`az returned output that is not JSON: ${text.slice(0, 200)}`, "UNEXPECTED_OUTPUT", [
      "Retry with --raw to read the unparsed az output",
    ]);
  }
}

/** Run az and return stdout as text (used for `--help` style commands). */
export async function azText(args: string[]): Promise<string> {
  const result = await azRaw([...stripOutputFlags(args), "--only-show-errors"]);
  if (result.exitCode !== 0) {
    throw mapAzError([result.stderr, result.stdout].filter(Boolean).join("\n").trim(), result.exitCode);
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

const NOT_LOGGED_IN = /(az login)|(Please run 'az login')|(No subscription found)|(AADSTS)|(refresh token has expired)/i;
const NOT_FOUND = /(ResourceNotFound)|(was not found)|(could not be found)|(NotFound)/i;
const FORBIDDEN = /(AuthorizationFailed)|(does not have authorization)|(Forbidden)|(InsufficientPrivileges)/i;
const UNKNOWN_COMMAND =
  /(is not in the '.*' command group)|(unrecognized arguments)|(invalid choice)|(not an az command)|(is misspelled or not recognized)|(are misspelled or not recognized)/i;
const EXTENSION_MISSING = /(is not installed)|(extension is not installed)|(The command requires the extension)/i;

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
