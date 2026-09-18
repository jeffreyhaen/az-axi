import { AxiError } from "axi-sdk-js";

/**
 * az-axi owns a small reserved flag set; everything else is forwarded to az
 * verbatim so the full Azure CLI surface stays reachable without a per-service
 * allowlist to maintain.
 */
export const RESERVED_VALUE_FLAGS = new Set(["fields", "limit", "for"]);
export const RESERVED_BOOL_FLAGS = new Set(["full", "reveal", "execute", "confirm", "raw", "dry-run"]);

export interface SplitArgs {
  /** Arguments forwarded to az. */
  azArgs: string[];
  fields?: string[];
  limit?: number;
  /** Streaming window in milliseconds (`--for 30s`). */
  forMs?: number;
  full: boolean;
  reveal: boolean;
  execute: boolean;
  confirm: boolean;
  raw: boolean;
  dryRun: boolean;
}

export function splitArgs(argv: readonly string[]): SplitArgs {
  const azArgs: string[] = [];
  const out: SplitArgs = {
    azArgs,
    full: false,
    reveal: false,
    execute: false,
    confirm: false,
    raw: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (!arg.startsWith("--")) {
      azArgs.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;

    if (RESERVED_BOOL_FLAGS.has(name)) {
      if (inline !== undefined && !/^(true|false)$/i.test(inline)) {
        throw new AxiError(`--${name} does not take a value`, "VALIDATION_ERROR", [
          `Use --${name} on its own`,
        ]);
      }
      setBool(out, name, inline === undefined ? true : inline.toLowerCase() === "true");
      continue;
    }

    if (RESERVED_VALUE_FLAGS.has(name)) {
        const value = inline ?? argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new AxiError(`--${name} requires a value`, "VALIDATION_ERROR", [
          name === "fields"
            ? "Example: --fields name,resourceGroup,location"
            : name === "for"
              ? "Example: --for 30s"
              : "Example: --limit 20",
        ]);
      }
      if (inline === undefined) index++;
      if (name === "fields") {
        out.fields = value
          .split(",")
          .map((field) => field.trim())
          .filter(Boolean);
      } else if (name === "for") {
        out.forMs = parseDuration(value);
      } else {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new AxiError(`--limit expects a positive number, got '${value}'`, "VALIDATION_ERROR", [
            "Example: --limit 20",
          ]);
        }
        out.limit = Math.floor(parsed);
      }
      continue;
    }

    azArgs.push(arg);
  }

  return out;
}

/** Parse `30s`, `2m`, or a bare number of seconds into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/i.exec(value.trim());
  if (!match) {
    throw new AxiError(`--for expects a duration such as 30s or 2m, got '${value}'`, "VALIDATION_ERROR", [
      "Example: --for 30s",
    ]);
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const ms = unit === "ms" ? amount : unit === "m" ? amount * 60_000 : amount * 1000;
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new AxiError(`--for expects a positive duration, got '${value}'`, "VALIDATION_ERROR", [
      "Example: --for 30s",
    ]);
  }
  return Math.floor(ms);
}

function setBool(target: SplitArgs, name: string, value: boolean): void {
  switch (name) {
    case "full":
      target.full = value;
      break;
    case "reveal":
      target.reveal = value;
      break;
    case "execute":
      target.execute = value;
      break;
    case "confirm":
      target.confirm = value;
      break;
    case "raw":
      target.raw = value;
      break;
    case "dry-run":
      target.dryRun = value;
      break;
    default:
      break;
  }
}

/** Render an az invocation the way a human would type it. */
export function renderCommand(args: readonly string[]): string {
  return ["az", ...args].map(quoteIfNeeded).join(" ");
}

function quoteIfNeeded(token: string): string {
  return /[\s"']/.test(token) ? JSON.stringify(token) : token;
}
