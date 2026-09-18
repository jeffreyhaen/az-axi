#!/usr/bin/env node
/**
 * Measures the context an Azure MCP server costs before any work happens.
 *
 *   node scripts/benchmark/capture-surface.mjs
 *
 * Starts the official Azure MCP server over stdio, asks for its tool list the
 * way an MCP client does, and stores the schemas in benchmark/tool-surface.json.
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "benchmark", "tool-surface.json");
const packageSpec = process.env.AZURE_MCP_PACKAGE ?? "@azure/mcp@latest";

const child = spawn("npx", ["-y", packageSpec, "server", "start"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

let buffer = "";
const pending = new Map();

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) > -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  }
});

child.on("error", (error) => {
  console.error(`failed to start the Azure MCP server: ${error.message}`);
  process.exit(2);
});

const send = (id, method, params) =>
  new Promise((resolveMessage, reject) => {
    pending.set(id, resolveMessage);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 120_000).unref();
  });

try {
  await send(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "az-axi-benchmark", version: "1" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const tools = [];
  let cursor;
  do {
    const response = await send(tools.length + 2, "tools/list", cursor ? { cursor } : {});
    tools.push(...(response.result?.tools ?? []));
    cursor = response.result?.nextCursor;
  } while (cursor);

  writeFileSync(
    out,
    `${JSON.stringify({ package: packageSpec, capturedAt: new Date().toISOString(), tools }, null, 2)}\n`,
    "utf8",
  );
  console.log(`recorded ${tools.length} tool schemas from ${packageSpec} into benchmark/tool-surface.json`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
