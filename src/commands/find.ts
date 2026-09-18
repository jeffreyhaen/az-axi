import { azText } from "../lib/az.js";
import { parseAzHelp, type AzHelpEntry } from "../lib/azHelp.js";
import { countLine } from "../lib/format.js";
import { splitArgs } from "../lib/split.js";

const DEFAULT_LIMIT = 30;

/**
 * Discovery without a hand-maintained catalog: az itself is the index. The
 * longest token prefix that resolves to a real command group is expanded, and
 * the remaining tokens filter that group's subgroups and commands.
 */
export async function findCommand(argv: string[]): Promise<Record<string, unknown>> {
  const options = splitArgs(argv);
  const tokens = options.azArgs.filter((token) => !token.startsWith("-"));
  const limit = options.full ? Number.POSITIVE_INFINITY : (options.limit ?? DEFAULT_LIMIT);

  for (let index = tokens.length; index >= 0; index--) {
    const base = tokens.slice(0, index);
    const query = tokens.slice(index).join(" ").toLowerCase();
    let text: string;
    try {
      text = await azText([...base, "--help"]);
    } catch {
      continue;
    }
    const tree = parseAzHelp(text);
    const groups = filter(tree.groups, query);
    const commands = filter(tree.commands, query);
    if (query !== "" && groups.length === 0 && commands.length === 0 && index > 0) continue;

    const scope = base.length === 0 ? "az" : `az ${base.join(" ")}`;
    const out: Record<string, unknown> = {
      scope,
      ...(query === "" ? {} : { query }),
      ...(tree.summary === "" ? {} : { summary: tree.summary }),
      count: `${countLine(Math.min(groups.length, limit), groups.length, "groups")}, ${countLine(
        Math.min(commands.length, limit),
        commands.length,
        "commands",
      )}`,
    };
    if (groups.length > 0) out.groups = groups.slice(0, limit);
    if (commands.length > 0) out.commands = commands.slice(0, limit);
    if (groups.length === 0 && commands.length === 0) {
      out.status = `0 matches for '${query}' in \`${scope}\``;
    }
    out.help = [
      base.length === 0
        ? "Run `az-axi find <group> <text>` to search inside a group"
        : `Run \`az-axi ${base.join(" ")} <command>\` to execute one`,
      "Run `az-axi <group> --help` for the compacted az help of a group",
    ];
    return out;
  }

  return {
    status: `0 matches for '${tokens.join(" ")}'`,
    help: ["Run `az-axi find` to list every Azure CLI command group"],
  };
}

function filter(entries: readonly AzHelpEntry[], query: string): AzHelpEntry[] {
  if (query === "") return [...entries];
  const needles = query.split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const haystack = `${entry.name} ${entry.summary}`.toLowerCase();
    return needles.every((needle) => haystack.includes(needle));
  });
}
