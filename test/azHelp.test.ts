import { describe, expect, it } from "vitest";
import { parseAzHelp } from "../src/lib/azHelp.js";
import { lensFor } from "../src/lib/lenses.js";

const AZ_ACCOUNT_HELP = `
Group
    az account : Manage Azure subscription information.

Subgroups:
    lock             : Manage Azure subscription level locks.
    management-group : Manage Azure Management Groups.

Commands:
    clear            : Clear all subscriptions from the CLI's local cache.
    list             : Get a list of subscriptions for the logged in account. By default, only
                       'Enabled' subscriptions from the current cloud is shown.
    list-locations [Preview] : List supported regions for the current subscription.
    show             : Get the details of a subscription.

To search AI knowledge base for examples, use: az find "az account"
`;

describe("parseAzHelp", () => {
  it("splits subgroups from commands and joins wrapped summaries", () => {
    const tree = parseAzHelp(AZ_ACCOUNT_HELP);
    expect(tree.title).toBe("az account");
    expect(tree.summary).toBe("Manage Azure subscription information.");
    expect(tree.groups.map((group) => group.name)).toEqual(["lock", "management-group"]);
    expect(tree.commands.map((command) => command.name)).toEqual([
      "clear",
      "list",
      "list-locations",
      "show",
    ]);
    expect(tree.commands[1]?.summary).toMatch(/only 'Enabled' subscriptions/);
  });

  it("parses the top-level help, which has no summary", () => {
    const tree = parseAzHelp("\nGroup\n    az\n\nSubgroups:\n    vm : Manage VMs.\n");
    expect(tree.title).toBe("az");
    expect(tree.groups).toEqual([{ name: "vm", summary: "Manage VMs." }]);
  });
});

describe("lensFor", () => {
  it("matches the longest command prefix and ignores flags", () => {
    expect(lensFor(["storage", "account", "list", "-g", "rg"])?.noun).toBe("storage accounts");
    expect(lensFor(["group", "list"])?.noun).toBe("resource groups");
    expect(lensFor(["kusto", "cluster", "list"])).toBeUndefined();
  });
});
