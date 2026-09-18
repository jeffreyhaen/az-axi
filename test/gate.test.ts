import { describe, expect, it } from "vitest";
import { assertNotInteractive, classify, commandShape, gate, isStreaming } from "../src/lib/gate.js";

describe("classify", () => {
  it("treats list/show style verbs as reads", () => {
    expect(classify(["vm", "list", "-g", "rg"])).toBe("read");
    expect(classify(["storage", "account", "show", "-n", "sa"])).toBe("read");
    expect(classify(["vm", "list-sizes"])).toBe("read");
    expect(classify(["account"])).toBe("read");
  });

  it("treats writes as mutations and deletes as destructive", () => {
    expect(classify(["vm", "start", "-n", "vm1"])).toBe("mutation");
    expect(classify(["group", "create", "-n", "rg"])).toBe("mutation");
    expect(classify(["group", "delete", "-n", "rg"])).toBe("destructive");
    expect(classify(["keyvault", "secret", "purge", "-n", "s"])).toBe("destructive");
  });

  it("classifies az rest by http method", () => {
    expect(classify(["rest", "--method", "get", "--url", "https://example"])).toBe("read");
    expect(classify(["rest", "--url", "https://example"])).toBe("read");
    expect(classify(["rest", "--method=post", "--url", "https://example"])).toBe("mutation");
  });
});

describe("commandShape", () => {
  it("stops at the first flag", () => {
    expect(commandShape(["network", "vnet", "list", "-g", "rg"]).path).toEqual(["network", "vnet", "list"]);
  });
});

describe("gate", () => {
  const base = { command: "az vm start -n vm1", execute: false, confirm: false } as const;

  it("lets reads through", () => {
    expect(gate({ ...base, classification: "read" })).toBeUndefined();
  });

  it("blocks mutations until --execute", () => {
    const blocked = gate({ ...base, classification: "mutation" });
    expect(blocked?.output.status).toMatch(/--execute required/);
    expect(blocked?.output.plan).toBe(base.command);
    expect(gate({ ...base, classification: "mutation", execute: true })).toBeUndefined();
  });

  it("blocks destructive commands until --execute and --confirm", () => {
    expect(gate({ ...base, classification: "destructive", execute: true })?.output.status).toMatch(
      /--confirm required/,
    );
    expect(gate({ ...base, classification: "destructive", execute: true, confirm: true })).toBeUndefined();
  });
});

describe("assertNotInteractive", () => {
  it("refuses az login instead of hanging on a prompt", () => {
    expect(() => assertNotInteractive(["login"])).toThrowError(/interactive/);
    expect(() => assertNotInteractive(["vm", "list"])).not.toThrow();
  });

  it("refuses verbs that attach to a terminal", () => {
    expect(() => assertNotInteractive(["webapp", "ssh"])).toThrowError(/interactive session/);
    expect(() => assertNotInteractive(["containerapp", "exec"])).toThrowError(/interactive session/);
    expect(() => assertNotInteractive(["aks", "browse"])).toThrowError(/interactive session/);
    expect(() => assertNotInteractive(["webapp", "list"])).not.toThrow();
  });
});

describe("isStreaming", () => {
  it("detects log tail and follow-style flags", () => {
    expect(isStreaming(["webapp", "log", "tail"], ["webapp", "log", "tail", "-g", "rg"])).toBe(true);
    expect(isStreaming(["functionapp", "log", "tail"], ["functionapp", "log", "tail"])).toBe(true);
    expect(isStreaming(["containerapp", "logs", "show"], ["containerapp", "logs", "show", "--follow"])).toBe(true);
  });

  it("leaves bounded commands alone", () => {
    expect(isStreaming(["containerapp", "logs", "show"], ["--tail", "50"])).toBe(false);
    expect(isStreaming(["webapp", "log", "download"], ["-g", "rg"])).toBe(false);
    expect(isStreaming(["vm", "list"], ["-g", "rg"])).toBe(false);
  });
});
