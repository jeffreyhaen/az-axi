---
name: az-axi
description: Use az-axi to run any Azure CLI command through one compact passthrough with token-efficient TOON output, redacted secrets, and gated mutations. Use when the task involves Azure resources, subscriptions, resource groups, VMs, App Service, AKS, Container Apps, storage, Key Vault, networking, Log Analytics, Entra ID objects, RBAC, or any `az` command.
user-invocable: false
---

# az-axi

Agent-ergonomic wrapper around the official Azure CLI. Every `az` module works — there is no
per-service allowlist. Prefer `az-axi` over raw `az`: the output is compacted, secrets are
redacted, and mutations cannot fire by accident.

Install globally with `npm install -g @jeffreyhaen/az-axi`. If `az-axi` is not on PATH, prefix
commands with `npx -y @jeffreyhaen/az-axi`.

Requires Azure CLI on PATH and an existing `az login` session. `az-axi` never prompts — if a
login is missing, tell the user to run `az login` in their own terminal.

## Orientation

```sh
az-axi                 # subscription, tenant, signed-in identity, resource groups
az-axi doctor          # az version, extensions, login, subscription, cloud
```

Run `az-axi` first when you do not know which subscription is active. Run `az-axi doctor` before
production work.

## Running az commands

Write the `az` command without the `az` prefix:

```sh
az-axi group list
az-axi vm list -g platform
az-axi webapp show -g web -n contoso-api
az-axi aks list --fields name,resourceGroup,kubernetesVersion
az-axi rest --method get --url "https://management.azure.com/tenants?api-version=2022-12-01"
```

Use `az-axi az <module> ...` when a module name collides with an az-axi command
(`find`, `doctor`, `setup`, `update`, `run`, `home`) — for example `az-axi az find "how do I..."`.

All az flags pass through unchanged: `--subscription`, `-g/--resource-group`, `--name`,
`--query`, `-d`, module-specific flags. Do not pass `-o/--output`; az-axi owns the output format.

## Discovery

```sh
az-axi find                       # every top-level az command group
az-axi find storage               # groups and commands matching 'storage'
az-axi find network vnet peer     # search inside `az network vnet`
az-axi containerapp --help        # subgroups and commands of one group, compacted
```

These read the installed Azure CLI's own help, so they are never stale. Do not dump raw
`az ... --help` output into context; use these instead.

## Mutations

Reads run immediately. Everything else is a two-step contract:

```sh
az-axi vm start -g rg -n vm1                      # returns the plan, changes nothing
az-axi vm start -g rg -n vm1 --execute            # applies it
az-axi group delete -n scratch --yes --execute --confirm   # delete-style needs both
```

- Only run a mutation when the user explicitly asked for that change. Show the dry-run plan first
  when there is any doubt.
- `--dry-run` forces the plan for any command, including reads.
- Azure CLI confirmation prompts must be suppressed with the command's own flag (`--yes`), since
  az-axi disables interactive prompts.
- `az login`, `az logout`, and `az interactive` are refused — ask the user to run them.

## Output control

| Flag | Use |
|---|---|
| `--fields a,b.c` | Pick columns; dot paths allowed (`sku.name`, `properties.runningStatus`) |
| `--limit <n>` | Rows to show (default 50; the total is always reported) |
| `--full` | Untruncated, unpruned, uncapped payload — use sparingly |
| `--reveal` | Show secret values (keys, connection strings, Key Vault secrets) |
| `--raw` | `az` stdout as text, for commands whose output is not JSON |

Lists report `count` (for example `3 of 312 virtual machines`) and an explicit `0 ... found`
empty state. Each result ends with `help[]` next steps — follow them instead of guessing.

## Reading secrets

Secret-looking values are `***` by default. Ask for them explicitly only when the task needs them:

```sh
az-axi keyvault secret show --vault-name kv -n api-key --reveal
az-axi storage account keys list -g data -n stacct --reveal
```

Never echo a revealed secret into a commit, a PR comment, or a file.

## Common workflows

```sh
# What is deployed in a resource group?
az-axi resource list -g platform

# App Service triage
az-axi webapp list -g web
az-axi webapp log tail -g web -n contoso-api --raw

# Container Apps triage
az-axi containerapp list -g rg
az-axi containerapp revision list -g rg -n api
az-axi containerapp logs show -g rg -n api --tail 50 --raw

# Logs
az-axi monitor log-analytics query -w <workspace-id> \
  --analytics-query "AppExceptions | where TimeGenerated > ago(1h) | take 20"

# Access
az-axi role assignment list --assignee <upn-or-object-id> --all
az-axi ad user list --filter "startswith(displayName,'Jane')"
```

## Failure handling

Errors are structured on stdout with an actionable `help[]`:

- `AZ_NOT_INSTALLED` — Azure CLI is missing; ask the user to install it.
- `AUTH_REQUIRED` — ask the user to run `az login`; never attempt it yourself.
- `EXTENSION_REQUIRED` — `az extension add --name <name>` (a mutation; needs `--execute`).
- `VALIDATION_ERROR` (exit 2) — wrong command or flag; run `az-axi find <text>` or `--help`.
- `FORBIDDEN` / `NOT_FOUND` — check subscription, resource group, and role assignment.

Exit codes: 0 success (including dry-run plans and empty results), 1 runtime error, 2 usage error.
