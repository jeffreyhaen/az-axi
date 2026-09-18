import { AxiError } from "axi-sdk-js";
import { azJson, azStream, azText, mapAzError } from "../lib/az.js";
import { parseAzHelp } from "../lib/azHelp.js";
import { compactList, isRecord, project, prune } from "../lib/compact.js";
import { countLine } from "../lib/format.js";
import { assertNotInteractive, classify, commandShape, gate, isStreaming } from "../lib/gate.js";
import { lensFor } from "../lib/lenses.js";
import { redactSecrets } from "../lib/redact.js";
import { renderCommand, splitArgs } from "../lib/split.js";

export const DEFAULT_LIMIT = 50;

/** A live stream has no end, so az-axi captures a window and says so. */
export const DEFAULT_STREAM_MS = 15_000;
export const DEFAULT_STREAM_LINES = 200;

/**
 * The single passthrough every Azure CLI module flows through. Nothing here is
 * service-specific: lenses and generic compaction shape the output, the gate
 * decides whether a mutation may run, and unknown flags go straight to az.
 */
export async function runCommand(argv: string[]): Promise<Record<string, unknown>> {
  const options = splitArgs(argv);
  const args = options.azArgs;

  if (args.length === 0) {
    throw new AxiError("an az command is required", "VALIDATION_ERROR", [
      "Example: az-axi group list",
      "Example: az-axi vm list -g <group> --fields name,location",
      "Run `az-axi find <text>` to search command groups",
    ]);
  }

  const { path } = commandShape(args);
  assertNotInteractive(path);

  if (args.includes("--help") || args.includes("-h")) {
    return helpOutput(args);
  }

  const command = renderCommand(args);
  const classification = classify(args);
  const blocked =
    options.dryRun && classification !== "read"
      ? { blocked: true as const, output: dryRunOutput(command, classification) }
      : gate({
          classification,
          execute: options.execute,
          confirm: options.confirm,
          command,
        });
  if (blocked) return blocked.output;
  if (options.dryRun) {
    return { plan: command, classification, status: "dry run — read-only command, nothing executed" };
  }

  if (isStreaming(path, args)) {
    return streamOutput(command, args, options);
  }

  if (options.raw) {
    const text = await azText(args);
    return {
      command,
      output: text.trim() === "" ? "(no output)" : text,
    };
  }

  const payload = await azJson(args);
  const context = path.join(" ");
  const value = redactSecrets(payload, { reveal: options.reveal, context });
  const lens = lensFor(args);

  const result: Record<string, unknown> = { command };
  if (classification !== "read") result.status = "applied";

  if (value === undefined || value === null) {
    result.result = classification === "read" ? "(no output)" : "done";
    return withHelp(result, lens?.next, path);
  }

  if (Array.isArray(value)) {
    const noun = lens?.noun ?? "items";
    if (value.length === 0) {
      result.count = `0 ${noun}`;
      result.status = `0 ${noun} found for \`${command}\``;
      return withHelp(result, lens?.next, path);
    }
    const limit = options.full ? value.length : (options.limit ?? DEFAULT_LIMIT);
    const rows = value.slice(0, limit);
    result.count = countLine(rows.length, value.length, noun);
    result.items = compactList(rows, options.fields ?? lens?.fields, options);
    if (rows.length < value.length) {
      result.hint = `use --limit <n> or --full for the remaining ${value.length - rows.length}`;
    }
    return withHelp(result, lens?.next, path);
  }

  if (isRecord(value)) {
    const fields = options.fields ?? (options.full ? undefined : lens?.fields);
    result.result = fields ? project(value, fields) : prune(value, options);
    return withHelp(result, lens?.next, path);
  }

  result.result = value;
  return withHelp(result, lens?.next, path);
}

/**
 * A live stream is captured for a bounded window instead of forever. The result
 * always states the window and why it ended, so an agent never mistakes a
 * closed window for "these are all the logs".
 */
async function streamOutput(
  command: string,
  args: readonly string[],
  options: { forMs?: number; limit?: number; full: boolean; reveal: boolean },
): Promise<Record<string, unknown>> {
  const forMs = options.forMs ?? DEFAULT_STREAM_MS;
  const maxLines = options.limit ?? DEFAULT_STREAM_LINES;
  const result = await azStream([...args], { forMs, maxLines });

  if (result.exitCode !== undefined && result.exitCode !== 0 && result.lines.length === 0) {
    throw mapAzError([result.stderr, result.lines.join("\n")].filter(Boolean).join("\n").trim(), result.exitCode);
  }

  const window = formatDuration(forMs);
  const out: Record<string, unknown> = {
    command,
    window,
    count: `${result.lines.length} ${result.lines.length === 1 ? "line" : "lines"}`,
  };
  out.status =
    result.stoppedBy === "window"
      ? `captured ${result.lines.length} lines in ${window}; the stream is still running in Azure`
      : result.stoppedBy === "limit"
        ? `stopped at the ${maxLines}-line budget; the stream is still running in Azure`
        : `az exited on its own after ${result.lines.length} lines`;
  out.lines = redactSecrets(result.lines, { reveal: options.reveal, context: "log" });
  if (result.lines.length === 0) {
    out.status = `no output in ${window} — the app may be idle or file logging may be off`;
  }
  out.help = [
    `Widen the window with --for 60s, or raise the line budget with --limit ${maxLines * 2}`,
    'Query history instead: `az-axi monitor app-insights query --app <app> --analytics-query "traces | top 50 by timestamp desc"`',
  ];
  return out;
}

function formatDuration(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

function dryRunOutput(command: string, classification: string): Record<string, unknown> {
  return {
    plan: command,
    classification,
    status: "dry run — nothing changed",
    help: [`Run the same command with --execute to apply it`],
  };
}

function withHelp(
  result: Record<string, unknown>,
  next: string[] | undefined,
  path: readonly string[],
): Record<string, unknown> {
  const group = path.slice(0, Math.max(1, path.length - 1)).join(" ");
  const help = [
    ...(next ?? []),
    `Run \`az-axi ${group} --help\` for the commands in this group`,
    "Add --fields a,b to pick columns, --full for the untruncated payload",
  ];
  result.help = help.slice(0, 4);
  return result;
}

/** `--help` is answered from az itself, compacted to subgroups and commands. */
async function helpOutput(args: readonly string[]): Promise<Record<string, unknown>> {
  const path = args.filter((arg) => !arg.startsWith("-"));
  const text = await azText([...path, "--help"]);
  const tree = parseAzHelp(text);
  const out: Record<string, unknown> = {
    command: `az ${path.join(" ")}`.trim(),
    summary: tree.summary,
  };
  if (tree.groups.length > 0) out.groups = tree.groups;
  if (tree.commands.length > 0) out.commands = tree.commands;
  out.help = [
    `Run \`az-axi ${[...path, "<command>"].join(" ")}\``,
    "Mutations need --execute (delete-style commands also need --confirm)",
  ];
  return out;
}
