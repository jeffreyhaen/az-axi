#!/usr/bin/env node
/**
 * Replays the recorded Azure CLI output and compares what an agent has to read.
 *
 *   node scripts/benchmark/bench.mjs [--json] [--only <id>]
 *
 * No network access, no credentials: the `az` on PATH is a shim that answers
 * from benchmark/fixtures. The `az-axi` binary itself runs unmodified.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "../../benchmark/scenarios.mjs";
import { DEFAULT_ENCODING, countTokens } from "./tokens.mjs";
import { installShim } from "./shim.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(root, "dist", "bin", "az-axi.js");
const fixturesDir = join(root, "benchmark", "fixtures");
const shimSource = join(root, "scripts", "benchmark", "az-shim.mjs");
const resultsPath = join(root, "benchmark", "results.json");
const reportPath = join(root, "BENCHMARK.md");

const asJson = process.argv.includes("--json");
const only = flag("--only");

if (!existsSync(cli)) {
  console.error("dist/bin/az-axi.js not found — run `pnpm run build` first");
  process.exit(2);
}

const fixtures = existsSync(fixturesDir)
  ? readdirSync(fixturesDir).filter((name) => name.endsWith(".jsonl"))
  : [];

if (fixtures.length === 0) {
  console.error(
    [
      "no benchmark fixtures found.",
      "",
      "Recorded Azure payloads describe a real tenant, so they are not part of this",
      "repository. Record your own corpus first:",
      "",
      "  cp benchmark/targets.example.json benchmark/targets.json   # edit names and ids",
      "  pnpm run build",
      "  pnpm run bench:capture",
      "  pnpm run bench",
      "",
      "See BENCHMARK.md for the method.",
    ].join("\n"),
  );
  process.exit(2);
}

const shimDir = join(root, "benchmark", ".shim");
const path = installShim(shimDir, shimSource);
const rows = [];
let failures = 0;

for (const scenario of SCENARIOS) {
  if (only && scenario.id !== only) continue;
  const fixture = join(fixturesDir, `${scenario.id}.jsonl`);
  if (!existsSync(fixture)) continue;

  const calls = readFileSync(fixture, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const metaPath = join(fixturesDir, `${scenario.id}.meta.json`);
  const argv = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")).argv : scenario.argv;

  const rawJson = calls.map((call) => minify(call.stdout)).join("\n");
  const rawPretty = calls.map((call) => call.stdout).join("\n");

  const result = spawnSync(process.execPath, [cli, ...argv], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: path, Path: path, AZ_AXI_BENCH_MODE: "replay", AZ_AXI_BENCH_FIXTURE: fixture },
  });

  if (result.status !== 0) {
    failures += 1;
    console.error(`FAIL  ${scenario.id}: exit ${result.status}\n${result.stdout || result.stderr}`);
    continue;
  }

  const toon = result.stdout ?? "";
  rows.push({
    id: scenario.id,
    group: scenario.group,
    label: scenario.label,
    command: `az-axi ${scenario.argv.map(placeholder).join(" ")}`,
    calls: calls.length,
    rawJson: countTokens(rawJson),
    rawPretty: countTokens(rawPretty),
    toon: countTokens(toon),
  });
}

rmSync(shimDir, { recursive: true, force: true });

if (rows.length === 0) {
  console.error("no scenarios replayed");
  process.exit(2);
}

for (const row of rows) {
  row.reduction = row.rawJson === 0 ? 0 : (row.toon - row.rawJson) / row.rawJson;
  row.reductionPretty = row.rawPretty === 0 ? 0 : (row.toon - row.rawPretty) / row.rawPretty;
}

const totals = {
  rawJson: sum(rows, "rawJson"),
  rawPretty: sum(rows, "rawPretty"),
  toon: sum(rows, "toon"),
};
const summary = {
  scenarios: rows.length,
  weighted: (totals.toon - totals.rawJson) / totals.rawJson,
  weightedPretty: (totals.toon - totals.rawPretty) / totals.rawPretty,
  mean: rows.reduce((acc, row) => acc + row.reduction, 0) / rows.length,
  meanPretty: rows.reduce((acc, row) => acc + row.reductionPretty, 0) / rows.length,
  median: median(rows.map((row) => row.reduction)),
  totals,
};

const payload = {
  generatedAt: new Date().toISOString(),
  version: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
  encoding: DEFAULT_ENCODING,
  summary,
  rows,
  surface: surface(),
};

writeFileSync(resultsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  const markdown = report(payload);
  assertNoTargetValues(markdown);
  writeFileSync(reportPath, markdown, "utf8");
  console.log(table(rows));
  console.log(
    `\n${rows.length} scenarios · ${fmt(totals.rawJson)} raw tokens → ${fmt(totals.toon)} TOON tokens ` +
      `(weighted ${pct(summary.weighted)}, mean ${pct(summary.mean)}, median ${pct(summary.median)})`,
  );
  console.log(`\nWrote BENCHMARK.md and benchmark/results.json`);
}

process.exit(failures > 0 ? 1 : 0);

/**
 * BENCHMARK.md is committed, targets.json names real resources. Nothing from the
 * latter may ever reach the former, so refuse to write instead of leaking.
 */
function assertNoTargetValues(markdown) {
  const targetsPath = join(root, "benchmark", "targets.json");
  if (!existsSync(targetsPath)) return;
  const values = Object.values(JSON.parse(readFileSync(targetsPath, "utf8")))
    .map((value) => String(value))
    .filter((value) => value.length > 2 && !value.startsWith("<"));
  const haystack = markdown.toLowerCase();
  const leaked = values.filter((value) => haystack.includes(value.toLowerCase()));
  if (leaked.length > 0) {
    console.error(
      `refusing to write BENCHMARK.md: it contains values from benchmark/targets.json (${leaked.join(", ")})`,
    );
    process.exit(1);
  }
}

function surface() {
  const surfacePath = join(root, "benchmark", "tool-surface.json");
  const skillPath = join(root, "SKILL.md");
  if (!existsSync(surfacePath) || !existsSync(skillPath)) return undefined;

  const recorded = JSON.parse(readFileSync(surfacePath, "utf8"));
  const skill = readFileSync(skillPath, "utf8");
  const frontmatter = skill.split("---")[1] ?? "";
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).stdout ?? "";

  return {
    mcpPackage: recorded.package,
    capturedAt: recorded.capturedAt,
    mcpTools: recorded.tools.length,
    mcpTokens: countTokens(JSON.stringify(recorded.tools)),
    skillFrontmatter: countTokens(frontmatter),
    skillBody: countTokens(skill),
    cliHelp: countTokens(help),
  };
}

/** `{vmResourceGroup}` reads as `<vm-resource-group>`: never a real resource name. */
function placeholder(arg) {
  const match = /^\{(\w+)\}$/.exec(arg);
  if (!match) return arg;
  return `<${match[1].replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}>`;
}

function minify(stdout) {
  try {
    return JSON.stringify(JSON.parse(stdout));
  } catch {
    return stdout;
  }
}

function sum(rows, key) {
  return rows.reduce((acc, row) => acc + row[key], 0);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function fmt(value) {
  return value.toLocaleString("en-US");
}

function table(rows) {
  const header = ["scenario", "calls", "az JSON", "az pretty", "az-axi", "reduction"];
  const body = rows.map((row) => [
    row.label,
    String(row.calls),
    fmt(row.rawJson),
    fmt(row.rawPretty),
    fmt(row.toon),
    pct(row.reduction),
  ]);
  const widths = header.map((_, index) =>
    Math.max(header[index].length, ...body.map((cells) => cells[index].length)),
  );
  const line = (cells) =>
    cells.map((cell, index) => (index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index]))).join("  ");
  return [line(header), widths.map((width) => "-".repeat(width)).join("  "), ...body.map(line)].join("\n");
}

function report(payload) {
  const date = payload.generatedAt.slice(0, 10);
  const lines = [
    "# az-axi benchmark",
    "",
    `Generated by \`pnpm run bench\` on ${date} · az-axi v${payload.version} · tokenizer \`${payload.encoding}\`.`,
    "",
    "The recordings behind these numbers are **not** published. They were captured against a private Azure subscription, and an Azure resource inventory is that subscription's data. What is published is the harness, so anyone can reproduce the measurement against their own subscription:",
    "",
    "```sh",
    "cp benchmark/targets.example.json benchmark/targets.json   # edit resource group, region and resource names",
    "pnpm run build",
    "pnpm run bench:capture                                     # records real az output, stays local",
    "pnpm run bench:surface                                     # optional: MCP tool-surface schemas",
    "pnpm run bench                                             # replays offline and rewrites this file",
    "```",
    "",
    "Your own numbers will differ: payload size depends on how many resources you own, which services they use and how verbose their ARM representations are. The reduction is a property of the corpus, not a promise.",
    "",
    "Every row replays a recorded Azure CLI response and compares what an agent would have to read:",
    "",
    "- **az JSON** — the payload as `az <command> -o json` returns it (minified).",
    "- **az pretty** — the same payload indented, the way the Azure CLI prints it by default.",
    "- **az-axi** — the TOON written to stdout by the command in the row.",
    "",
    "## Summary",
    "",
    "| Metric | vs az JSON | vs az pretty |",
    "| --- | --- | --- |",
    `| Weighted (all tokens in the corpus) | ${pct(payload.summary.weighted)} | ${pct(payload.summary.weightedPretty)} |`,
    `| Mean per scenario | ${pct(payload.summary.mean)} | ${pct(payload.summary.meanPretty)} |`,
    `| Median per scenario | ${pct(payload.summary.median)} | — |`,
    "",
    `Corpus: ${payload.summary.scenarios} scenarios, ${fmt(payload.summary.totals.rawJson)} az tokens reduced to ${fmt(payload.summary.totals.toon)} TOON tokens.`,
    "",
    "## Payload benchmark",
    "",
    "| Scenario | Command | Calls | az JSON | az pretty | az-axi | Reduction |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const row of payload.rows) {
    lines.push(
      `| ${row.label} | \`${row.command}\` | ${row.calls} | ${fmt(row.rawJson)} | ${fmt(row.rawPretty)} | ${fmt(row.toon)} | ${pct(row.reduction)} |`,
    );
  }

  lines.push("", "## Tool-surface benchmark", "");

  if (payload.surface) {
    const s = payload.surface;
    lines.push(
      "An MCP server sends its full tool schemas on every turn. A skill file only keeps its frontmatter in context; the body is read when the agent decides the skill is relevant, and `--help` is paid only when the agent asks for it.",
      "",
      "| Surface | Tokens | Paid |",
      "| --- | ---: | --- |",
      `| Azure MCP tool schemas (${s.mcpTools} tools) | ${fmt(s.mcpTokens)} | every turn |`,
      `| \`SKILL.md\` frontmatter (name + description) | ${fmt(s.skillFrontmatter)} | always in context |`,
      `| \`SKILL.md\` body | ${fmt(s.skillBody)} | once, when the agent opens the skill |`,
      `| \`az-axi --help\` | ${fmt(s.cliHelp)} | on demand |`,
      "",
      `MCP schemas captured from \`${s.mcpPackage}\` on ${s.capturedAt.slice(0, 10)}.`,
    );
  } else {
    lines.push("Run `pnpm run bench:surface` to record the Azure MCP server's tool schemas and include this comparison.");
  }

  lines.push(
    "",
    "## Method",
    "",
    "1. `node scripts/benchmark/capture.mjs` puts a recording shim named `az` first on PATH and runs each scenario against a real subscription, storing every Azure CLI call the shipped binary makes.",
    "2. `node scripts/benchmark/bench.mjs` replays those recordings through the same shim with no network access, and counts tokens on both sides.",
    "3. The shim is how both sides stay comparable: the measured binary is the published one, with no benchmark-only code paths in `src/`.",
    "",
    "### Honesty notes",
    "",
    "- Recordings never leave the machine that made them. `benchmark/fixtures/`, `benchmark/targets.json` and `benchmark/results.json` are git-ignored, and the bench refuses to write this file when any value from `targets.json` appears in it.",
    "- The command column shows the scenario as written, with `<placeholders>` where the harness substitutes your own resource names. Only aggregate token counts are published.",
    "- Both columns are derived from the **same** recorded payload, so the reduction percentages are exact for this corpus.",
    "- Scenarios that return an empty result are dropped during capture: there is nothing to compress, and keeping them would distort the mean in either direction.",
    "- Listing commands are measured as an agent would use them, which includes az-axi's default limit of 50 rows. `--full` opts back into the untruncated payload and is not part of these numbers.",
    "- Detail views (`show`) compress least: a single resource has no repetition to exploit. They are kept in the corpus precisely because they are the weakest case.",
    "- This benchmark measures **payload and tool-surface cost only**. It does not measure task success rate, turn count or end-to-end agent cost.",
    "",
    "Raw numbers land in `benchmark/results.json` after a local `pnpm run bench`.",
    "",
  );

  return lines.join("\n");
}

function flag(name) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : undefined;
}
