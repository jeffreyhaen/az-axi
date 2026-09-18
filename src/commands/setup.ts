import { AxiError, installSessionStartHooks, sessionStartHookStatus, uninstallSessionStartHooks } from "axi-sdk-js";
import { collapseHomeDirectory } from "../lib/paths.js";

const SUBCOMMANDS = ["install", "status", "uninstall"] as const;
type Scope = "user" | "project";

/**
 * Ambient context (AXI principle 7): install a SessionStart hook so a new agent
 * session already knows the active subscription before it runs anything.
 */
export async function setupCommand(argv: string[]): Promise<Record<string, unknown>> {
  const positionals = argv.filter((arg) => !arg.startsWith("-"));
  const sub = (positionals[0] ?? "install") as (typeof SUBCOMMANDS)[number];
  if (!SUBCOMMANDS.includes(sub)) {
    throw new AxiError(`unknown setup subcommand '${sub}'`, "VALIDATION_ERROR", [
      `Valid subcommands: ${SUBCOMMANDS.join(" | ")}`,
    ]);
  }

  const scopeIndex = argv.findIndex((arg) => arg === "--scope");
  const inline = argv.find((arg) => arg.startsWith("--scope="));
  const rawScope = inline ? inline.split("=")[1] : argv[scopeIndex + 1];
  const scope: Scope = scopeIndex >= 0 || inline ? (rawScope as Scope) : "user";
  if (scope !== "user" && scope !== "project") {
    throw new AxiError(`unknown --scope '${rawScope}'`, "VALIDATION_ERROR", [
      "Valid scopes: user | project",
    ]);
  }

  if (sub === "install") {
    const errors: string[] = [];
    installSessionStartHooks({ scope, onError: (message) => errors.push(message) });
    return { ...report(scope), status: "session hooks installed", ...(errors.length > 0 ? { warnings: errors } : {}) };
  }

  if (sub === "uninstall") {
    const errors: string[] = [];
    uninstallSessionStartHooks({ scope, onError: (message) => errors.push(message) });
    return { ...report(scope), status: "session hooks removed", ...(errors.length > 0 ? { warnings: errors } : {}) };
  }

  return { ...report(scope), status: "hook status" };
}

function report(scope: Scope): Record<string, unknown> {
  const status = sessionStartHookStatus({ scope });
  return {
    scope: status.scope,
    agents: [
      { agent: "claude", installed: status.claude.installed, path: collapseHomeDirectory(status.claude.path) },
      {
        agent: "codex",
        installed: status.codex.installed && status.codex.userFeatureEnabled,
        path: collapseHomeDirectory(status.codex.path),
      },
      { agent: "opencode", installed: status.opencode.installed, path: collapseHomeDirectory(status.opencode.path) },
    ],
    help: [
      "Run `az-axi setup install --scope project` for a repository-local hook",
      "Run `az-axi setup uninstall` to remove it",
    ],
  };
}
