/**
 * Declarative projections for the Azure CLI commands agents hit most often and
 * that return the most JSON per row. Everything not listed here still works —
 * the passthrough falls back to generic compaction — so this table is an
 * optimization, never a gate. Keys are matched as command prefixes.
 */
export interface Lens {
  /** Field paths (dot notation) kept for list rows and show output. */
  fields: string[];
  /** Noun used in count lines and empty states. */
  noun: string;
  /** Contextual next steps appended as `help[]`. */
  next?: string[];
}

export const LENSES: Record<string, Lens> = {
  "account list": {
    fields: ["name", "id", "isDefault", "state", "user.name"],
    noun: "subscriptions",
    next: ["Run `az-axi account set --subscription <name>` --execute"],
  },
  "account show": { fields: ["name", "id", "tenantId", "state", "user.name"], noun: "subscription" },
  "group list": {
    fields: ["name", "location", "properties.provisioningState"],
    noun: "resource groups",
    next: ["Run `az-axi resource list -g <name>`"],
  },
  "group show": { fields: ["name", "location", "id", "tags"], noun: "resource group" },
  "resource list": {
    fields: ["name", "resourceGroup", "type", "location"],
    noun: "resources",
    next: ["Run `az-axi resource show --ids <id>`"],
  },
  "vm list": {
    fields: ["name", "resourceGroup", "location", "hardwareProfile.vmSize", "powerState"],
    noun: "virtual machines",
    next: ["Run `az-axi vm list -d` for power state", "Run `az-axi vm show -g <group> -n <name>`"],
  },
  "vm show": {
    fields: [
      "name",
      "resourceGroup",
      "location",
      "hardwareProfile.vmSize",
      "provisioningState",
      "storageProfile.imageReference.offer",
      "storageProfile.osDisk.osType",
    ],
    noun: "virtual machine",
  },
  "webapp list": {
    fields: ["name", "resourceGroup", "state", "defaultHostName", "kind"],
    noun: "web apps",
    next: ["Run `az-axi webapp log download -g <group> -n <name>` for stored logs"],
  },
  "webapp show": {
    fields: ["name", "resourceGroup", "state", "defaultHostName", "httpsOnly", "kind"],
    noun: "web app",
  },
  "functionapp list": {
    fields: ["name", "resourceGroup", "state", "defaultHostName", "kind"],
    noun: "function apps",
  },
  "appservice plan list": {
    fields: ["name", "resourceGroup", "location", "sku.name", "numberOfSites"],
    noun: "app service plans",
  },
  "storage account list": {
    fields: ["name", "resourceGroup", "location", "kind", "sku.name"],
    noun: "storage accounts",
    next: ["Run `az-axi storage account show -g <group> -n <name>`"],
  },
  "storage blob list": {
    fields: ["name", "properties.contentLength", "properties.lastModified"],
    noun: "blobs",
  },
  "storage container list": { fields: ["name", "properties.lastModified"], noun: "containers" },
  "keyvault list": { fields: ["name", "resourceGroup", "location"], noun: "key vaults" },
  "keyvault secret list": {
    fields: ["name", "attributes.enabled", "attributes.updated"],
    noun: "secrets",
    next: ["Run `az-axi keyvault secret show --vault-name <vault> -n <name> --reveal`"],
  },
  "aks list": {
    fields: ["name", "resourceGroup", "location", "kubernetesVersion", "provisioningState"],
    noun: "clusters",
    next: ["Run `az-axi aks show -g <group> -n <name>`"],
  },
  "acr list": {
    fields: ["name", "resourceGroup", "location", "loginServer", "sku.name"],
    noun: "registries",
  },
  "acr repository list": { fields: ["name"], noun: "repositories" },
  "containerapp list": {
    fields: [
      "name",
      "resourceGroup",
      "properties.runningStatus",
      "properties.configuration.ingress.fqdn",
      "properties.latestRevisionName",
    ],
    noun: "container apps",
    next: ["Run `az-axi containerapp logs show -g <group> -n <name> --tail 50`"],
  },
  "containerapp show": {
    fields: [
      "name",
      "resourceGroup",
      "properties.runningStatus",
      "properties.configuration.ingress.fqdn",
      "properties.latestRevisionName",
      "properties.provisioningState",
    ],
    noun: "container app",
  },
  "sql server list": {
    fields: ["name", "resourceGroup", "location", "administratorLogin", "state"],
    noun: "sql servers",
  },
  "sql db list": {
    fields: ["name", "resourceGroup", "status", "currentServiceObjectiveName"],
    noun: "databases",
  },
  "cosmosdb list": { fields: ["name", "resourceGroup", "location", "kind"], noun: "accounts" },
  "network vnet list": {
    fields: ["name", "resourceGroup", "location", "addressSpace.addressPrefixes"],
    noun: "virtual networks",
  },
  "network nsg list": { fields: ["name", "resourceGroup", "location"], noun: "network security groups" },
  "network public-ip list": {
    fields: ["name", "resourceGroup", "ipAddress", "publicIPAllocationMethod"],
    noun: "public ip addresses",
  },
  "monitor log-analytics workspace list": {
    fields: ["name", "resourceGroup", "location", "customerId"],
    noun: "workspaces",
    next: ['Run `az-axi monitor log-analytics query -w <customerId> --analytics-query "Heartbeat | take 5"`'],
  },
  "ad user list": {
    fields: ["displayName", "userPrincipalName", "id"],
    noun: "users",
  },
  "ad group list": { fields: ["displayName", "id", "mailNickname"], noun: "groups" },
  "ad app list": { fields: ["displayName", "appId", "id"], noun: "applications" },
  "ad sp list": { fields: ["displayName", "appId", "id"], noun: "service principals" },
  "role assignment list": {
    fields: ["principalName", "roleDefinitionName", "scope", "principalType"],
    noun: "role assignments",
  },
  "role definition list": {
    fields: ["roleName", "roleType", "description"],
    noun: "role definitions",
  },
  "deployment group list": {
    fields: ["name", "properties.provisioningState", "properties.timestamp"],
    noun: "deployments",
  },
  "extension list": { fields: ["name", "version", "experimental"], noun: "extensions" },
  "vm image list": { fields: ["urn", "offer", "sku", "version"], noun: "images" },
  "staticwebapp list": {
    fields: ["name", "resourceGroup", "defaultHostname", "repositoryUrl"],
    noun: "static web apps",
  },
  "servicebus namespace list": {
    fields: ["name", "resourceGroup", "location", "sku.name", "status"],
    noun: "namespaces",
  },
  "eventhubs namespace list": {
    fields: ["name", "resourceGroup", "location", "sku.name", "status"],
    noun: "namespaces",
  },
  "redis list": {
    fields: ["name", "resourceGroup", "location", "sku.name", "provisioningState"],
    noun: "caches",
  },
  "apim list": {
    fields: ["name", "resourceGroup", "location", "sku.name", "gatewayUrl"],
    noun: "api management services",
  },
};

const SORTED_KEYS = Object.keys(LENSES).sort((a, b) => b.split(" ").length - a.split(" ").length);

/** Longest matching command-prefix lens, ignoring flags. */
export function lensFor(tokens: readonly string[]): Lens | undefined {
  const positional = tokens.filter((token) => !token.startsWith("-"));
  for (const key of SORTED_KEYS) {
    const parts = key.split(" ");
    if (parts.every((part, index) => positional[index] === part)) return LENSES[key];
  }
  return undefined;
}
