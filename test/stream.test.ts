import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { makeStreamer, type SpawnLike } from "../src/lib/az.js";

/**
 * `az webapp log tail` writes the stream to stderr as `WARNING:` lines, so a
 * fake child that only speaks stdout would not reproduce the real thing.
 */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    pid?: number;
    kill: () => boolean;
    unref: () => void;
    killed: boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = undefined;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  child.unref = () => undefined;
  return child;
}

function streamerWith(child: ReturnType<typeof fakeChild>, capture?: { args: string[]; env: unknown }[]) {
  const launch: SpawnLike = ((_command: string, args: string[], options: Record<string, unknown>) => {
    capture?.push({ args, env: options.env });
    return child;
  }) as unknown as SpawnLike;
  return makeStreamer(launch);
}

describe("stream capture", () => {
  it("reads the log stream from stderr and strips the WARNING prefix", async () => {
    const child = fakeChild();
    const promise = streamerWith(child)(["webapp", "log", "tail"], { forMs: 5_000, maxLines: 10 });
    child.stderr.write("WARNING: 2026-09-18 GET / 200\n");
    child.stderr.write("2026-09-18 GET /health 200\n");
    child.emit("close", 0);

    const result = await promise;
    expect(result.lines).toEqual(["2026-09-18 GET / 200", "2026-09-18 GET /health 200"]);
  });

  it("never asks az for --only-show-errors, which would suppress the stream", async () => {
    const child = fakeChild();
    const calls: { args: string[]; env: unknown }[] = [];
    const promise = streamerWith(child, calls)(["webapp", "log", "tail"], { forMs: 5_000, maxLines: 10 });
    child.emit("close", 0);
    await promise;

    expect(calls[0]?.args).not.toContain("--only-show-errors");
    expect((calls[0]?.env as Record<string, string>).AZURE_CORE_ONLY_SHOW_ERRORS).toBe("false");
  });

  it("stops at the line budget and kills the child", async () => {
    const child = fakeChild();
    const promise = streamerWith(child)(["webapp", "log", "tail"], { forMs: 60_000, maxLines: 2 });
    child.stderr.write("one\ntwo\nthree\n");

    const result = await promise;
    expect(result.lines).toEqual(["one", "two"]);
    expect(result.stoppedBy).toBe("limit");
    expect(child.killed).toBe(true);
  });

  it("closes the window even when the child ignores the kill", async () => {
    const child = fakeChild();
    const started = Date.now();
    const result = await streamerWith(child)(["webapp", "log", "tail"], { forMs: 40, maxLines: 10 });

    expect(result.stoppedBy).toBe("window");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("keeps ERROR lines out of the payload and reports them as the failure", async () => {
    const child = fakeChild();
    const promise = streamerWith(child)(["webapp", "log", "tail"], { forMs: 5_000, maxLines: 10 });
    child.stderr.write("ERROR: (ResourceNotFound) could not be found\n");
    child.emit("close", 1);

    const result = await promise;
    expect(result.lines).toEqual([]);
    expect(result.stderr).toMatch(/could not be found/);
    expect(result.exitCode).toBe(1);
  });
});
