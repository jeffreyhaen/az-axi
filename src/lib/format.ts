export const DEFAULT_TRUNCATE = 1200;

export interface Truncated {
  text: string;
  truncated: boolean;
  total: number;
}

export function truncate(value: string, limit = DEFAULT_TRUNCATE): Truncated {
  const total = value.length;
  if (total <= limit) return { text: value, truncated: false, total };
  return {
    text: `${value.slice(0, limit)}\n... (truncated, ${total} chars total — use --full)`,
    truncated: true,
    total,
  };
}

/** `2025-01-08T14:22:31.123Z` -> `2025-01-08` (or `2025-01-08 14:22` when recent). */
export function shortDate(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const iso = date.toISOString();
  const ageDays = (Date.now() - date.getTime()) / 86_400_000;
  return ageDays < 7 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

export function countLine(shown: number, total: number, noun: string): string {
  return shown === total ? `${shown} ${noun}` : `${shown} of ${total} ${noun}`;
}

export function emptyState(noun: string, context: string): string {
  return `0 ${noun} found ${context}`.trim();
}

/** Read `a.b.c` from a nested object. Returns undefined when any hop is missing. */
export function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** The last path segment, used as the column name for `a.b.c` projections. */
export function pathLabel(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1] ?? path;
}
