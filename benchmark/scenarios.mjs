/**
 * Benchmark corpus. Each scenario is a real `az-axi` invocation. The capture
 * step runs the underlying `az` command once and records its stdout; the bench
 * step replays that recording through a fake `az` on PATH, so the shipped CLI
 * runs completely unmodified and the comparison is apples to apples.
 *
 * Placeholders in `argv` are filled from benchmark/targets.json.
 */
export const SCENARIOS = [
  {
    id: "group-list",
    group: "subscription",
    label: "group list",
    argv: ["group", "list"],
  },
  {
    id: "resource-list-all",
    group: "subscription",
    label: "resource list (subscription)",
    argv: ["resource", "list"],
  },
  {
    id: "resource-list-group",
    group: "subscription",
    label: "resource list -g",
    argv: ["resource", "list", "-g", "{resourceGroup}"],
  },
  {
    id: "account-list",
    group: "subscription",
    label: "account list",
    argv: ["account", "list"],
  },
  {
    id: "vm-list",
    group: "compute",
    label: "vm list",
    argv: ["vm", "list"],
  },
  {
    id: "vm-list-size",
    group: "compute",
    label: "vm list-sizes (region)",
    argv: ["vm", "list-sizes", "-l", "{location}"],
  },
  {
    id: "webapp-list",
    group: "app platform",
    label: "webapp list",
    argv: ["webapp", "list"],
  },
  {
    id: "functionapp-list",
    group: "app platform",
    label: "functionapp list",
    argv: ["functionapp", "list"],
  },
  {
    id: "appservice-plan-list",
    group: "app platform",
    label: "appservice plan list",
    argv: ["appservice", "plan", "list"],
  },
  {
    id: "containerapp-list",
    group: "app platform",
    label: "containerapp list",
    argv: ["containerapp", "list"],
  },
  {
    id: "storage-account-list",
    group: "data",
    label: "storage account list",
    argv: ["storage", "account", "list"],
  },
  {
    id: "sql-server-list",
    group: "data",
    label: "sql server list",
    argv: ["sql", "server", "list"],
  },
  {
    id: "keyvault-list",
    group: "data",
    label: "keyvault list",
    argv: ["keyvault", "list"],
  },
  {
    id: "cosmosdb-list",
    group: "data",
    label: "cosmosdb list",
    argv: ["cosmosdb", "list"],
  },
  {
    id: "aks-list",
    group: "containers",
    label: "aks list",
    argv: ["aks", "list"],
  },
  {
    id: "acr-list",
    group: "containers",
    label: "acr list",
    argv: ["acr", "list"],
  },
  {
    id: "network-vnet-list",
    group: "network",
    label: "network vnet list",
    argv: ["network", "vnet", "list"],
  },
  {
    id: "network-nsg-list",
    group: "network",
    label: "network nsg list",
    argv: ["network", "nsg", "list"],
  },
  {
    id: "network-public-ip-list",
    group: "network",
    label: "network public-ip list",
    argv: ["network", "public-ip", "list"],
  },
  {
    id: "role-assignment-list",
    group: "identity",
    label: "role assignment list",
    argv: ["role", "assignment", "list", "--all"],
  },
  {
    id: "role-definition-list",
    group: "identity",
    label: "role definition list",
    argv: ["role", "definition", "list"],
  },
  {
    id: "ad-user-list",
    group: "identity",
    label: "ad user list",
    argv: ["ad", "user", "list"],
  },
  {
    id: "ad-app-list",
    group: "identity",
    label: "ad app list",
    argv: ["ad", "app", "list"],
  },
  {
    id: "deployment-group-list",
    group: "operations",
    label: "deployment group list",
    argv: ["deployment", "group", "list", "-g", "{resourceGroup}"],
  },
  {
    id: "monitor-alert-list",
    group: "operations",
    label: "monitor metrics alert list",
    argv: ["monitor", "metrics", "alert", "list"],
  },
  {
    id: "vm-show",
    group: "detail views",
    label: "vm show",
    argv: ["vm", "show", "-g", "{vmResourceGroup}", "-n", "{vm}"],
    optional: true,
  },
  {
    id: "webapp-show",
    group: "detail views",
    label: "webapp show",
    argv: ["webapp", "show", "-g", "{webappResourceGroup}", "-n", "{webapp}"],
    optional: true,
  },
  {
    id: "storage-account-show",
    group: "detail views",
    label: "storage account show",
    argv: ["storage", "account", "show", "-g", "{storageResourceGroup}", "-n", "{storageAccount}"],
    optional: true,
  },
];
