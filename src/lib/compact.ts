import { pathLabel, readPath, truncate } from "./format.js";

export interface CompactOptions {
  fields?: string[];
  full?: boolean;
  limit?: number;
}

const MAX_STRING = 400;
const MAX_NESTED_ARRAY = 8;
const MAX_DEPTH = 4;

/** Keys worth showing when no lens or --fields narrows a list. Order matters. */
const GENERIC_FIELDS = [
  "name",
  "displayName",
  "resourceGroup",
  "location",
  "type",
  "kind",
  "state",
  "status",
  "provisioningState",
  "powerState",
  "sku.name",
  "version",
  "userPrincipalName",
  "appId",
  "id",
];

const GENERIC_FIELD_LIMIT = 5;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Project one row onto `fields`, keeping dot paths readable as flat columns. */
export function project(row: unknown, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const labels = columnLabels(fields);
  fields.forEach((field, index) => {
    out[labels[index] as string] = scalarize(readPath(row, field));
  });
  return out;
}

/** `sku.name` becomes `name`, unless another field already claimed that label. */
export function columnLabels(fields: readonly string[]): string[] {
  const taken = new Set<string>();
  return fields.map((field) => {
    const short = pathLabel(field);
    if (!taken.has(short)) {
      taken.add(short);
      return short;
    }
    const full = field.replace(/\./g, "_");
    taken.add(full);
    return full;
  });
}

/** Field set used for a list when the caller did not pass --fields. */
export function genericFields(rows: readonly unknown[]): string[] | undefined {
  const sample = rows.find(isRecord);
  if (!sample) return undefined;
  const present = GENERIC_FIELDS.filter((field) => readPath(sample, field) !== undefined);
  if (present.length === 0) return undefined;
  return present.slice(0, GENERIC_FIELD_LIMIT);
}

/** Flatten a value into something TOON can render as a compact table or record. */
export function compactList(
  rows: readonly unknown[],
  fields: readonly string[] | undefined,
  options: CompactOptions = {},
): Array<Record<string, unknown> | unknown> {
  const effective = fields ?? (options.full ? undefined : genericFields(rows));
  if (!effective) return rows.map((row) => prune(row, options));
  return rows.map((row) => (isRecord(row) ? project(row, effective) : row));
}

/** Depth-, size-, and length-bounded copy of an az payload. */
export function prune(value: unknown, options: CompactOptions = {}, depth = 0): unknown {
  if (options.full) return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_NESTED_ARRAY).map((item) => prune(item, options, depth + 1));
    if (value.length > MAX_NESTED_ARRAY) items.push(`... ${value.length - MAX_NESTED_ARRAY} more`);
    return items;
  }
  if (isRecord(value)) {
    if (depth >= MAX_DEPTH) return "{...}";
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (isEmpty(child)) continue;
      out[key] = prune(child, options, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return truncate(value, MAX_STRING).text;
  return value;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

/** Arrays and objects inside a projected column collapse to one printable cell. */
function scalarize(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((item) => (isRecord(item) ? JSON.stringify(item) : String(item))).join(" ");
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "";
    return entries.map(([key, child]) => `${key}=${String(child)}`).join(" ");
  }
  return value;
}
