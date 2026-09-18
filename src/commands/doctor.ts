import { azJson, azRaw } from "../lib/az.js";
import { splitArgs } from "../lib/split.js";

interface VersionPayload {
  "azure-cli"?: string;
  extensions?: Record<string, string>;
}

interface AccountPayload {
  name?: string;
  id?: string;
  tenantId?: string;
  state?: string;
  environmentName?: string;
  user?: { name?: string; type?: string };
}

export async function doctorCommand(argv: string[]): Promise<Record<string, unknown>> {
  const options = splitArgs(argv);
  const checks: Array<Record<string, unknown>> = [];
  const help: string[] = [];

  const installed = await azRaw(["version", "--output", "json", "--only-show-errors"]).catch(
    () => undefined,
  );
  if (!installed || installed.exitCode !== 0) {
    checks.push({ check: "azure-cli", status: "missing", detail: "`az` is not installed or not on PATH" });
    help.push("Install Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli");
    return { checks, status: "azure cli unavailable", help };
  }

  let version: VersionPayload = {};
  try {
    version = JSON.parse(installed.stdout) as VersionPayload;
  } catch {
    version = {};
  }
  checks.push({
    check: "azure-cli",
    status: "ok",
    detail: version["azure-cli"] ?? "unknown version",
  });

  const extensions = Object.entries(version.extensions ?? {});
  checks.push({
    check: "extensions",
    status: extensions.length > 0 ? "ok" : "none",
    detail:
      extensions.length > 0
        ? extensions.map(([name, ext]) => `${name} ${ext}`).join(", ")
        : "no extensions installed",
  });

  let account: AccountPayload | undefined;
  try {
    account = await azJson<AccountPayload>(["account", "show"]);
  } catch (error) {
    checks.push({
      check: "login",
      status: "failed",
      detail: (error as Error).message,
    });
    help.push("Run `az login` in a human terminal — az-axi never prompts");
    return { checks, status: "not signed in", help };
  }

  checks.push({
    check: "login",
    status: account?.state === "Enabled" ? "ok" : (account?.state ?? "unknown"),
    detail: account?.user?.name ?? "",
  });
  checks.push({
    check: "subscription",
    status: "ok",
    detail: `${account?.name ?? ""} (${account?.id ?? ""})`,
  });
  checks.push({ check: "tenant", status: "ok", detail: account?.tenantId ?? "" });
  checks.push({ check: "cloud", status: "ok", detail: account?.environmentName ?? "AzureCloud" });

  const failing = checks.filter((check) => check.status !== "ok" && check.status !== "none");
  const result: Record<string, unknown> = {
    checks: options.full ? checks : checks.map(({ check, status, detail }) => ({ check, status, detail })),
    status: failing.length === 0 ? "ready" : `${failing.length} check(s) need attention`,
  };
  result.help = [
    ...help,
    "Run `az-axi account list` to see every subscription",
    "Run `az-axi <command> --subscription <id>` to target another subscription",
  ].slice(0, 3);
  return result;
}
