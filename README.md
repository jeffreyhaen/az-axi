# az-axi (Azure CLI axi)

[![ci](https://github.com/jeffreyhaen/az-axi/actions/workflows/ci.yml/badge.svg)](https://github.com/jeffreyhaen/az-axi/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40jeffreyhaen%2Faz-axi.svg)](https://www.npmjs.com/package/@jeffreyhaen/az-axi)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

Agent-ergonomic CLI for **Azure** — every Azure CLI module through one compact passthrough,
in token-efficient [TOON](https://toonformat.dev/) output, with secrets redacted and mutations
gated behind `--execute`.

`az-axi` is an Azure [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface): a CLI
designed for autonomous agents rather than humans. It wraps the official `az` CLI instead of
re-implementing it, so the entire Azure surface stays reachable — and stays current — without a
hand-maintained command catalog.

## Why a passthrough

The Azure CLI has thousands of commands across hundreds of modules. Wrapping them one by one
produces a surface that is stale the week after it ships. `az-axi` inverts that: **one generic
passthrough** does the token work (TOON output, field projection, truncation, counts, redaction,
mutation gating), and a small declarative lens table only adds curated columns for the
highest-traffic, most verbose commands. Nothing is gated on being in that table.

```sh
az-axi group list                      # curated columns
az-axi kusto cluster list              # no lens, still compacted
az-axi rest --method get --url https://management.azure.com/tenants?api-version=2022-12-01
```

## Install

```sh
npm install -g @jeffreyhaen/az-axi
az-axi --help
```

For a one-off invocation without installing:

```sh
npx -y @jeffreyhaen/az-axi --help
```

Requires the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) on `PATH` and a
signed-in session (`az login`). `az-axi` never prompts and never logs you in.

## Agent integration

```sh
npx skills add jeffreyhaen/az-axi --skill az-axi -g   # on-demand skill
az-axi setup install                                  # ambient session hook
```

`setup install` registers a SessionStart hook for Claude Code, Codex, and OpenCode so a session
starts with the active subscription already in context. `--scope project` keeps it repo-local,
`az-axi setup status` reports it, `az-axi setup uninstall` removes it.

## Use

```sh
az-axi                                   # subscription, tenant, identity, resource groups
az-axi doctor                            # az version, extensions, login, subscription
az-axi find storage                      # search the az command tree
az-axi webapp --help                     # compacted az help for a group

az-axi group list
az-axi vm list -g platform --fields name,location,hardwareProfile.vmSize
az-axi storage account list --limit 10
az-axi aks show -g platform -n prod-cluster
az-axi containerapp logs show -g rg -n api --tail 50
az-axi monitor log-analytics query -w <workspace-id> --analytics-query "Heartbeat | take 5"
az-axi keyvault secret show --vault-name kv -n api-key --reveal

az-axi vm start -g platform -n build-01            # dry-run plan, nothing changes
az-axi vm start -g platform -n build-01 --execute  # applied
az-axi group delete -n scratch --yes --execute --confirm
```

Every flag `az-axi` does not own is forwarded to `az` unchanged — `--subscription`, `-g`,
`--query`, `--name`, module-specific flags, all of it.

## Behavior

- **Mutations are gated.** Reads run immediately. Anything else returns the exact `az` command as
  a dry-run plan and changes nothing until `--execute` is passed; `delete`/`purge`/`remove`-style
  commands additionally require `--confirm`. `--dry-run` forces the plan for any command.
- **Secrets are redacted.** Keys, tokens, connection strings, and secret values print as `***`
  unless `--reveal` is passed.
- **Bounded output.** Lists show 50 rows with the real total (`3 of 312 virtual machines`), records
  are pruned of empty values, long strings are truncated. `--limit`, `--fields a,b.c`, and `--full`
  control all of it.
- **Discovery without a catalog.** `az-axi find` and `az-axi <group> --help` read the Azure CLI's
  own help tree, so discovery can never drift from the installed `az`.
- **No prompts, ever.** `az login`, `az logout`, and `az interactive` are refused with instructions
  instead of hanging on a prompt an agent cannot answer.
- **Windows-safe process launch.** `az` is spawned through `cross-spawn`, which resolves `az.cmd`
  on Windows; command resolution stays in the spawn layer instead of platform branches in the CLI.
- **Exit codes.** 0 success (including dry-run plans and empty results), 1 runtime error, 2 usage
  error.

## az-axi flags

| Flag | Meaning |
|---|---|
| `--fields a,b.c` | Pick columns; dot paths are allowed (`sku.name`) |
| `--limit <n>` | Rows to show (default 50) |
| `--full` | No truncation, no pruning, no row cap |
| `--reveal` | Do not redact secret-looking values |
| `--execute` | Actually run a mutating command |
| `--confirm` | Additionally required for delete-style commands |
| `--dry-run` | Print the exact `az` command without running it |
| `--raw` | Return `az` stdout as text instead of compacted TOON |

## Design

Built against the ten [AXI principles](https://axi.md/): TOON output, minimal default schemas,
truncation with `--full`, pre-computed totals, definitive empty states, structured errors on
stdout with exit code 2 for usage errors, ambient session hooks, a content-first no-argument view,
contextual next-step hints, and concise per-command help.

Adding a lens is a table entry in [`src/lib/lenses.ts`](src/lib/lenses.ts) — field paths, a noun,
and optional next steps. No new command module, no new tests required.

## Development

```sh
pnpm install
pnpm run build
pnpm test
```

### Releasing

1. Move the `Unreleased` section in `CHANGELOG.md` under `## [x.y.z] - <date>`.
2. Bump `version` in `package.json`.
3. Commit as `chore: release vX.Y.Z`, then tag and push:

```sh
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push --follow-tags
```

Pushing the tag runs `.github/workflows/release.yml`: it builds, tests, publishes to npm, and
creates the GitHub release with the matching `CHANGELOG.md` section as its body.

## License

MIT

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## See also

- [AXI — agent eXperience interface](https://axi.md/) · [kunchenguid/axi](https://github.com/kunchenguid/axi)
- [TOON — token-optimized object notation](https://toonformat.dev/) · [toonformat/toon](https://github.com/toonformat/toon)
- [ado-axi](https://github.com/jeffreyhaen/ado-axi) · [mssql-axi](https://github.com/jeffreyhaen/mssql-axi) · [msgraph-axi](https://github.com/jeffreyhaen/msgraph-axi)
