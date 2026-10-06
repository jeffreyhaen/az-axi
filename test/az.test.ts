import { EventEmitter } from "node:events";
import spawn from "cross-spawn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { azRaw, azStream, mapAzError } from "../src/lib/az.js";

vi.mock("cross-spawn", () => ({ default: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("extension safety", () => {
  it.each(["buffered", "streaming"])("disables implicit installation for %s commands despite inherited config", async (mode) => {
    vi.stubEnv("AZURE_EXTENSION_USE_DYNAMIC_INSTALL", "yes_without_prompt");
    const child = Object.assign(new EventEmitter(), {
      stdout: null,
      stderr: null,
      kill: () => true,
      unref: () => undefined,
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const result = mode === "buffered"
      ? azRaw(["group", "list"])
      : azStream(["webapp", "log", "tail"], { forMs: 5_000, maxLines: 10 });
    child.emit("close", 0);
    await result;

    expect(spawn).toHaveBeenCalledWith("az", expect.any(Array), expect.objectContaining({
      env: expect.objectContaining({ AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no" }),
      stdio: ["ignore", "pipe", "pipe"],
    }));
  });

  it.each([
    ["The command requires the extension containerapp. Do you want to install it now?\nEOF when reading a line", "containerapp"],
    ["The extension 'aks-preview' is not installed.", "aks-preview"],
    ["The command requires the latest version of extension azure-devops. To install, run 'az extension add --upgrade -n azure-devops'.", "azure-devops"],
    ["The extension is not installed.", "<name>"],
  ])("replaces unsafe Azure installation advice with a gated hint: %s", (message, name) => {
    const error = mapAzError(message, 1);
    expect(error.code).toBe("EXTENSION_REQUIRED");
    expect(error.message).toContain("Automatic extension installation is not allowed; explicit user permission is required");
    expect(error.message).not.toContain("az extension add");
    expect(error.suggestions).toContain(`Install only with user permission: \`az-axi extension add --name ${name} --execute\``);
  });

  it("does not treat an unrelated EOF as a missing extension", () => {
    expect(mapAzError("EOF when reading a line", 1).code).toBe("AZ_ERROR");
  });

  it("explains that an unknown command can require an explicitly installed extension", () => {
    const error = mapAzError("'iot' is misspelled or not recognized by the system.", 2);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.suggestions.join(" ")).toContain("az-axi extension add --name <name> --execute");
  });
});
