# Changelog

All notable changes to az-axi are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.1.3] - 2026-09-18

### Fixed

- A captured log stream returned nothing at all. `az webapp log tail` writes the stream to stderr as
  `WARNING:` lines rather than stdout, and `--only-show-errors` suppresses the stream entirely, so
  az-axi was reading the wrong stream of a silenced command. Both streams are now read as content,
  the `WARNING:` prefix is stripped, `ERROR:` lines are kept out of the payload and reported as the
  failure, and only-show-errors is off for the duration of a capture

## [0.1.2] - 2026-09-18

### Added

- Bounded log streaming: `webapp log tail`, `functionapp log tail`, and any command with `--follow`
  or `--stream` are captured for a window instead of being refused. The result reports the window,
  the line count, and why the capture ended, so a closed window is never mistaken for "these are all
  the logs". Raw `az` can only stream forever, so this is the one place az-axi does more than az
- `--for <duration>` sets the capture window (`30s`, `2m`, or a bare number of seconds; default 15s).
  `--limit <n>` doubles as the line budget for a stream (default 200)

### Fixed

- A captured stream no longer leaves an orphaned `az` process behind on Windows: `child.kill()` only
  signals the launcher, so the process tree is now terminated synchronously before az-axi exits

## [0.1.1] - 2026-09-18

### Fixed

- Streaming commands are refused up front instead of hanging: `az-axi` buffers a command to
  completion, so `webapp log tail`, `functionapp log tail`, and any command with `--follow` or
  `--stream` could never return. They now fail fast with `NOT_SUPPORTED` and point at the bounded
  alternative (`log download`, `--tail <n>`, an Application Insights query, or running `az` in a
  human terminal). Superseded by the bounded capture in 0.1.2
- Verbs that attach to a terminal (`ssh`, `exec`, `attach`, `browse`, `connect`) are refused for the
  same reason, next to the existing `az login`/`az logout` refusal
- `webapp list` no longer suggests `webapp log tail` as the next step, and `containerapp list`
  suggests `containerapp logs show --tail 50`

## [0.1.0] - 2026-09-18

Initial release.

### Added

- One generic passthrough over the whole Azure CLI: `az-axi <module> <verb> [args]` forwards every
  unrecognized flag to `az` unchanged, with `az-axi az <module> ...` as the escape hatch for module
  names that collide with an az-axi command
- TOON output with bounded lists (50 rows by default, always with the real total), pruned records,
  truncated strings, definitive empty states, and contextual `help[]` next steps
- `--fields a,b.c` (dot paths), `--limit`, `--full`, `--raw` for output control
- Declarative lens table (`src/lib/lenses.ts`) with curated columns for the highest-traffic
  commands: account, group, resource, vm, webapp, functionapp, appservice, storage, keyvault, aks,
  acr, containerapp, sql, cosmosdb, network, monitor, ad, role, deployment, and more
- Mutation gating: reads run immediately, mutations return the exact `az` command as a dry-run plan
  until `--execute`, delete-style commands additionally require `--confirm`, `--dry-run` forces the
  plan for any command
- Secret redaction by default (keys, tokens, connection strings, Key Vault values) with `--reveal`
- `az-axi find` and `az-axi <group> --help` read the installed Azure CLI's own help tree, so
  discovery cannot drift from the installed `az`
- `az-axi doctor` (az version, extensions, login, subscription, tenant, cloud) and a content-first
  home view with subscription context and resource groups
- `az-axi setup [install|status|uninstall] [--scope user|project]` for ambient SessionStart hooks in
  Claude Code, Codex, and OpenCode
- Structured errors mapped onto `AZ_NOT_INSTALLED`, `AUTH_REQUIRED`, `EXTENSION_REQUIRED`,
  `VALIDATION_ERROR`, `FORBIDDEN`, and `NOT_FOUND`, with exit code 2 for usage errors
- Interactive `az` commands (`login`, `logout`, `interactive`, ...) are refused with instructions
  instead of hanging on a prompt
- Windows-safe process launch: `az` is spawned through `cross-spawn`, which resolves `az.cmd`
  without platform branches in the CLI

### Benchmark

- Reproducible harness: `pnpm run bench:capture` records real `az` output locally,
  `pnpm run bench` replays it offline through an `az` shim on PATH and regenerates `BENCHMARK.md`,
  `pnpm run bench:surface` records the Azure MCP server's tool schemas
- Recordings describe a real tenant and stay git-ignored; only the harness is published
