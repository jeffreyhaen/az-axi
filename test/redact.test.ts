import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/lib/redact.js";

describe("redactSecrets", () => {
  it("hides secret-looking keys anywhere in the payload", () => {
    const payload = {
      name: "sa",
      keys: [{ keyName: "key1", value: "abc" }],
      primaryKey: "super-secret",
      connectionString: "DefaultEndpointsProtocol=https;AccountKey=abc",
    };
    const result = redactSecrets(payload, { context: "storage account keys list" });
    expect(result.primaryKey).toBe("***");
    expect(result.connectionString).toBe("***");
    expect(result.keys[0]?.value).toBe("***");
    expect(result.name).toBe("sa");
  });

  it("only hides a bare `value` in a secret context", () => {
    expect(redactSecrets({ value: "hello" }, { context: "config get" }).value).toBe("hello");
    expect(redactSecrets({ value: "hello" }, { context: "keyvault secret show" }).value).toBe("***");
  });

  it("returns the payload untouched with --reveal", () => {
    const payload = { primaryKey: "super-secret" };
    expect(redactSecrets(payload, { reveal: true })).toEqual(payload);
  });
});
