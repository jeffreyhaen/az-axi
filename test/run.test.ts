import { afterEach, describe, expect, it } from "vitest";
import { resetAzRunner, setAzRunner, type AzResult } from "../src/lib/az.js";
import { runCommand } from "../src/commands/run.js";

function stub(result: Partial<AzResult>, capture?: string[][]) {
  setAzRunner(async (args) => {
    capture?.push(args);
    return { stdout: "", stderr: "", exitCode: 0, ...result };
  });
}

afterEach(() => resetAzRunner());

describe("runCommand", () => {
  it("compacts a list through the matching lens and reports the total", async () => {
    const calls: string[][] = [];
    const rows = Array.from({ length: 3 }, (_, index) => ({
      name: `rg-${index}`,
      location: "westeurope",
      properties: { provisioningState: "Succeeded" },
      id: "/subscriptions/x",
      managedBy: null,
    }));
    stub({ stdout: JSON.stringify(rows) }, calls);

    const out = await runCommand(["group", "list"]);

    expect(calls[0]).toEqual(["group", "list", "--output", "json", "--only-show-errors"]);
    expect(out.command).toBe("az group list");
    expect(out.count).toBe("3 resource groups");
    expect(out.items).toEqual([
      { name: "rg-0", location: "westeurope", provisioningState: "Succeeded" },
      { name: "rg-1", location: "westeurope", provisioningState: "Succeeded" },
      { name: "rg-2", location: "westeurope", provisioningState: "Succeeded" },
    ]);
    expect(out.help).toBeDefined();
  });

  it("caps rows at the limit and keeps the total visible", async () => {
    stub({ stdout: JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ name: `vm-${i}` }))) });
    const out = await runCommand(["vm", "list", "--limit", "2"]);
    expect(out.count).toBe("2 of 10 virtual machines");
    expect(out.hint).toMatch(/remaining 8/);
  });

  it("gives a definitive empty state", async () => {
    stub({ stdout: "[]" });
    const out = await runCommand(["vm", "list"]);
    expect(out.count).toBe("0 virtual machines");
    expect(out.status).toBe("0 virtual machines found for `az vm list`");
  });

  it("never runs a mutation without --execute", async () => {
    const calls: string[][] = [];
    stub({ stdout: "{}" }, calls);
    const out = await runCommand(["vm", "start", "-g", "rg", "-n", "vm1"]);
    expect(calls).toHaveLength(0);
    expect(out.plan).toBe("az vm start -g rg -n vm1");
    expect(out.status).toMatch(/dry run/);
  });

  it("runs the mutation once --execute is passed", async () => {
    const calls: string[][] = [];
    stub({ stdout: "{}" }, calls);
    const out = await runCommand(["vm", "start", "-g", "rg", "-n", "vm1", "--execute"]);
    expect(calls[0]?.slice(0, 5)).toEqual(["vm", "start", "-g", "rg", "-n"]);
    expect(out.status).toBe("applied");
  });

  it("requires --confirm on top of --execute for deletes", async () => {
    const calls: string[][] = [];
    stub({ stdout: "{}" }, calls);
    const out = await runCommand(["group", "delete", "-n", "rg", "--yes", "--execute"]);
    expect(calls).toHaveLength(0);
    expect(out.status).toMatch(/--confirm required/);
  });

  it("redacts secrets unless --reveal is passed", async () => {
    stub({ stdout: JSON.stringify({ name: "api-key", value: "s3cr3t" }) });
    const hidden = (await runCommand(["keyvault", "secret", "show", "-n", "api-key"])).result as Record<
      string,
      unknown
    >;
    expect(hidden.value).toBe("***");

    stub({ stdout: JSON.stringify({ name: "api-key", value: "s3cr3t" }) });
    const shown = (await runCommand(["keyvault", "secret", "show", "-n", "api-key", "--reveal"]))
      .result as Record<string, unknown>;
    expect(shown.value).toBe("s3cr3t");
  });

  it("maps a login failure onto AUTH_REQUIRED", async () => {
    stub({ exitCode: 1, stderr: "ERROR: Please run 'az login' to setup account." });
    await expect(runCommand(["vm", "list"])).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("forwards unknown flags to az verbatim", async () => {
    const calls: string[][] = [];
    stub({ stdout: "[]" }, calls);
    await runCommand(["vm", "list", "--subscription", "sub", "-d", "--query", "[].name"]);
    expect(calls[0]).toEqual([
      "vm",
      "list",
      "--subscription",
      "sub",
      "-d",
      "--query",
      "[].name",
      "--output",
      "json",
      "--only-show-errors",
    ]);
  });

  it("refuses interactive az commands", async () => {
    await expect(runCommand(["login"])).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });

  it("answers --help from az itself, compacted", async () => {
    stub({ stdout: "Group\n    az vm : Manage VMs.\n\nCommands:\n    list : List VMs.\n" });
    const out = await runCommand(["vm", "--help"]);
    expect(out.summary).toBe("Manage VMs.");
    expect(out.commands).toEqual([{ name: "list", summary: "List VMs." }]);
  });
});
