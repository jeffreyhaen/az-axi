import { AxiError } from "axi-sdk-js";
import { azJson, azText } from "../lib/az.js";
import { parseAzHelp } from "../lib/azHelp.js";
import { compactList, isRecord, project, prune } from "../lib/compact.js";
import { countLine } from "../lib/format.js";
import { assertNotInteractive, classify, commandShape, gate } from "../lib/gate.js";
import { lensFor } from "../lib/lenses.js";
import { redactSecrets } from "../lib/redact.js";
import { renderCommand, splitArgs } from "../lib/split.js";

export const DEFAULT_LIMIT = 50;

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
