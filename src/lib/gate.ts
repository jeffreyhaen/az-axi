import { AxiError } from "axi-sdk-js";

export type Classification = "read" | "mutation" | "destructive";

const READ_VERB =
  /^(list|show|get|check|describe|exists|version|query|search|validate|wait|preview|export|download|tail|history|diagnose|analyze|find|status|ping|test-connection)(-|$)/;
const DESTRUCTIVE_VERB = /^(delete|purge|remove|destroy|down|uninstall|detach|revoke)(-|$)/;

/** Commands that only work with a human at the keyboard. */
const INTERACTIVE = new Set(["login", "logout", "interactive", "feedback", "upgrade", "survey"]);

export interface CommandShape {
  /** Positional command path, e.g. ["storage", "account", "create"]. */
  path: string[];
  /** The verb the classification is based on. */
  verb: string;
}

export function commandShape(args: readonly string[]): CommandShape {
  const path: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-")) break;
    path.push(arg);
  }
  return { path, verb: path[path.length - 1] ?? "" };
}

/** Decide whether an az invocation reads, mutates, or destroys. */
export function classify(args: readonly string[]): Classification {
  const { path, verb } = commandShape(args);
  if (path[0] === "rest") return restMethod(args) === "read" ? "read" : "mutation";
  if (DESTRUCTIVE_VERB.test(verb)) return "destructive";
  if (READ_VERB.test(verb)) return "read";
  if (path.length <= 1) return "read";
  return "mutation";
}

function restMethod(args: readonly string[]): "read" | "write" {
  const index = args.findIndex((arg) => arg === "--method" || arg === "-m");
  const inline = args.find((arg) => arg.startsWith("--method="));
  if (index < 0 && !inline) return "read";
  const method = (inline ? inline.split("=")[1] : args[index + 1]) ?? "get";
  return /^(get|head)$/i.test(method) ? "read" : "write";
}

export function assertNotInteractive(path: readonly string[]): void {
  const head = path[0] ?? "";
  if (!INTERACTIVE.has(head)) return;
  throw new AxiError(`\`az ${head}\` is interactive and is not available through az-axi`, "NOT_SUPPORTED", [
    head === "login" || head === "logout"
      ? `Run \`az ${head}\` yourself in a human terminal, then re-run az-axi`
      : `Run \`az ${head}\` yourself in a human terminal`,
    "Run `az-axi doctor` to check the current session",
  ]);
}

export interface GateInput {
  classification: Classification;
  execute: boolean;
  confirm: boolean;
  command: string;
}

export interface GateBlocked {
  blocked: true;
  output: Record<string, unknown>;
}

/**
 * Mutations never run implicitly: the first call returns the exact command it
 * would run, so an agent shows its plan before changing Azure.
 */
export function gate(input: GateInput): GateBlocked | undefined {
  if (input.classification === "read") return undefined;
  const destructive = input.classification === "destructive";
  if (input.execute && (!destructive || input.confirm)) return undefined;

  const missing = input.execute ? "--confirm" : "--execute";
  return {
    blocked: true,
    output: {
      plan: input.command,
      classification: input.classification,
      status: `dry run — nothing changed (${missing} required)`,
      help: [
        destructive
          ? `Run \`az-axi ${stripAz(input.command)} --execute --confirm\` to apply it`
          : `Run \`az-axi ${stripAz(input.command)} --execute\` to apply it`,
        "Only run the mutation when the user explicitly asked for it",
      ],
    },
  };
}

function stripAz(command: string): string {
  return command.replace(/^az /, "");
}
