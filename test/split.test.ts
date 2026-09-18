import { describe, expect, it } from "vitest";
import { renderCommand, splitArgs } from "../src/lib/split.js";

describe("splitArgs", () => {
  it("forwards unknown flags to az untouched", () => {
    const result = splitArgs(["vm", "list", "-g", "rg", "--query", "[].name", "--subscription", "sub"]);
    expect(result.azArgs).toEqual(["vm", "list", "-g", "rg", "--query", "[].name", "--subscription", "sub"]);
  });

  it("captures reserved flags without forwarding them", () => {
    const result = splitArgs(["vm", "list", "--fields", "name, location", "--limit=5", "--full", "--execute"]);
    expect(result.azArgs).toEqual(["vm", "list"]);
    expect(result.fields).toEqual(["name", "location"]);
    expect(result.limit).toBe(5);
    expect(result.full).toBe(true);
    expect(result.execute).toBe(true);
    expect(result.confirm).toBe(false);
  });

  it("rejects a value-less --fields and a non-numeric --limit", () => {
    expect(() => splitArgs(["vm", "list", "--fields"])).toThrowError(/--fields requires a value/);
    expect(() => splitArgs(["vm", "list", "--limit", "abc"])).toThrowError(/positive number/);
    expect(() => splitArgs(["vm", "list", "--full=maybe"])).toThrowError(/does not take a value/);
  });

  it("renders the az command a human would type", () => {
    expect(renderCommand(["vm", "list", "-g", "my rg"])).toBe('az vm list -g "my rg"');
  });
});
