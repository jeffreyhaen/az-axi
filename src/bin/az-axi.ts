#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "@toon-format/toon";
import { AxiError, runAxiCli } from "axi-sdk-js";
import { COMMAND_HELP, DESCRIPTION, TOP_LEVEL_HELP } from "../help.js";

const USAGE_CODES = new Set(["VALIDATION_ERROR", "UNKNOWN_FLAG", "AUTH_REQUIRED", "NOT_SUPPORTED"]);

/** az-axi's own commands. Everything else is an Azure CLI module. */
const BUILTINS = new Set(["az", "run", "find", "doctor", "setup", "home", "update"]);

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "../../package.json"), "utf8")) as {
      version?: string;
    };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function formatError(error: unknown): { output: string; exitCode: number } {
  if (error instanceof AxiError) {
    const out: Record<string, unknown> = { error: error.message, code: error.code };
    if (error.suggestions.length > 0) out.help = error.suggestions;
    return { output: `${encode(out)}\n`, exitCode: USAGE_CODES.has(error.code) ? 2 : 1 };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { output: `${encode({ error: message, code: "UNKNOWN" })}\n`, exitCode: 1 };
}

function leadingFlagError(flag: string): string {
  return `${encode({
    error: `\`${flag}\` must come after the command`,
    code: "VALIDATION_ERROR",
    help: [
      "Run `az-axi <module> <verb> [args] [flags]`",
      "Example: az-axi vm list -g platform --fields name,location",
      "Run `az-axi --help` for the full command surface",
    ],
  })}\n`;
}

async function runHandler(args: string[]) {
  return (await import("../commands/run.js")).runCommand(args);
}

async function findHandler(args: string[]) {
  return (await import("../commands/find.js")).findCommand(args);
}

async function doctorHandler(args: string[]) {
  return (await import("../commands/doctor.js")).doctorCommand(args);
}

async function setupHandler(args: string[]) {
  return (await import("../commands/setup.js")).setupCommand(args);
}

async function homeHandler() {
  return (await import("../commands/home.js")).homeCommand();
}

const argv = process.argv.slice(2);
const first = argv[0];

if (first !== undefined && first.startsWith("-") && !/^(--help|-h|-v|--version)$/.test(first)) {
  process.stdout.write(leadingFlagError(first));
  process.exit(2);
}

/** `az-axi vm list` is `az-axi az vm list`; the `az` prefix is only needed for name clashes. */
const normalized =
  first !== undefined && !first.startsWith("-") && !BUILTINS.has(first) ? ["az", ...argv] : argv;

await runAxiCli({
  description: DESCRIPTION,
  version: readVersion(),
  argv: normalized,
  topLevelHelp: TOP_LEVEL_HELP,
  getCommandHelp: (command) => COMMAND_HELP[command] ?? null,
  formatError,
  home: homeHandler,
  commands: {
    home: homeHandler,
    az: runHandler,
    run: runHandler,
    find: findHandler,
    doctor: doctorHandler,
    setup: setupHandler,
  },
});
