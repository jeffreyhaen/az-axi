import { AxiError } from "axi-sdk-js";
import { azJson } from "../lib/az.js";
import { countLine } from "../lib/format.js";
import { homeHeader } from "../lib/paths.js";
import { DESCRIPTION } from "../help.js";

interface AccountPayload {
  name?: string;
  id?: string;
  tenantId?: string;
  environmentName?: string;
  user?: { name?: string };
}

interface GroupPayload {
  name?: string;
  location?: string;
}

const GROUP_SAMPLE = 8;

export async function homeCommand(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = homeHeader(DESCRIPTION);

  let account: AccountPayload | undefined;
  try {
    account = await azJson<AccountPayload>(["account", "show"]);
  } catch (error) {
    out.status = error instanceof AxiError ? error.message : String(error);
    out.help = [
      "Run `az login` in a human terminal — az-axi never prompts",
      "Run `az-axi doctor` to re-check the session",
    ];
    return out;
  }

  out.subscription = account?.name ?? "";
  out.subscriptionId = account?.id ?? "";
  out.tenant = account?.tenantId ?? "";
  out.signedInAs = account?.user?.name ?? "";
  if (account?.environmentName && account.environmentName !== "AzureCloud") {
    out.cloud = account.environmentName;
  }

  try {
    const groups = (await azJson<GroupPayload[]>(["group", "list"])) ?? [];
    out.count = countLine(Math.min(groups.length, GROUP_SAMPLE), groups.length, "resource groups");
    out["resource-groups"] =
      groups.length === 0
        ? "0 resource groups in this subscription"
        : groups.slice(0, GROUP_SAMPLE).map((group) => ({
            name: group.name ?? "",
            location: group.location ?? "",
          }));
  } catch (error) {
    out["resource-groups"] = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }

  out.help = [
    "Run `az-axi group list` or `az-axi resource list -g <group>`",
    "Run `az-axi find <text>` to search every Azure CLI command group",
    "Run `az-axi <module> <verb>` for any az command (mutations need --execute)",
    "Run `az-axi doctor` before production work",
  ];
  return out;
}
