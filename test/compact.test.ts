import { describe, expect, it } from "vitest";
import { compactList, genericFields, project, prune } from "../src/lib/compact.js";
import { readPath } from "../src/lib/format.js";

describe("project", () => {
  it("flattens dot paths into single columns and keeps labels unique", () => {
    const row = { name: "sa", sku: { name: "Standard_LRS" }, tags: { env: "prod" } };
    expect(project(row, ["name", "sku.name", "tags", "missing"])).toEqual({
      name: "sa",
      sku_name: "Standard_LRS",
      tags: "env=prod",
      missing: "",
    });
  });
});

describe("readPath", () => {
  it("reads nested values and returns undefined for missing hops", () => {
    expect(readPath({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1);
    expect(readPath({ a: {} }, "a.b.c")).toBeUndefined();
    expect(readPath({ a: [{ b: 2 }] }, "a.0.b")).toBe(2);
  });
});

describe("genericFields", () => {
  it("picks the common Azure columns that exist on the payload", () => {
    const rows = [{ name: "vm1", resourceGroup: "rg", location: "westeurope", extra: true, id: "/subs/x" }];
    expect(genericFields(rows)).toEqual(["name", "resourceGroup", "location", "id"]);
  });

  it("returns undefined when nothing recognisable is present", () => {
    expect(genericFields([{ foo: 1 }])).toBeUndefined();
  });
});

describe("compactList", () => {
  it("projects rows onto the requested fields", () => {
    const rows = [
      { name: "a", sku: { name: "Standard_LRS" }, junk: "x" },
      { name: "b", sku: { name: "Premium_LRS" }, junk: "y" },
    ];
    expect(compactList(rows, ["name", "sku.name"])).toEqual([
      { name: "a", sku_name: "Standard_LRS" },
      { name: "b", sku_name: "Premium_LRS" },
    ]);
  });

  it("keeps the raw rows when --full is set", () => {
    const rows = [{ foo: null, bar: "x" }];
    expect(compactList(rows, undefined, { full: true })).toEqual(rows);
  });
});

describe("prune", () => {
  it("drops empty values and truncates long strings", () => {
    const pruned = prune({ a: "", b: null, c: [], d: {}, e: "x".repeat(500) }) as Record<string, string>;
    expect(Object.keys(pruned)).toEqual(["e"]);
    expect(pruned.e).toMatch(/truncated, 500 chars total/);
  });

  it("caps nested arrays with a remainder hint", () => {
    const pruned = prune({ items: Array.from({ length: 20 }, (_, index) => index + 1) }) as {
      items: unknown[];
    };
    expect(pruned.items).toHaveLength(9);
    expect(pruned.items.at(-1)).toBe("... 12 more");
  });
});
