export interface AzHelpEntry {
  name: string;
  summary: string;
}

export interface AzHelpTree {
  /** `az vm` for the group whose help was parsed. */
  title: string;
  summary: string;
  groups: AzHelpEntry[];
  commands: AzHelpEntry[];
}

const SECTION = /^([A-Za-z][A-Za-z ]*):\s*$/;
const ENTRY = /^\s{2,}([a-z0-9][a-z0-9-]*)\s*(?:\[[^\]]*\])?\s*:\s*(.*)$/;
const TITLE = /^\s{2,}(az(?: [a-z0-9-]+)*)\s*(?::\s*(.*))?$/;

/** Parse `az <group> --help` into the group's subgroups and commands. */
export function parseAzHelp(text: string): AzHelpTree {
  const tree: AzHelpTree = { title: "az", summary: "", groups: [], commands: [] };
  let section = "";
  let last: AzHelpEntry | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "") {
      last = undefined;
      continue;
    }

    const sectionMatch = SECTION.exec(line.trim());
    if (sectionMatch && !line.startsWith("    ")) {
      section = sectionMatch[1]?.toLowerCase() ?? "";
      last = undefined;
      continue;
    }

    if (tree.title === "az" && tree.summary === "" && section === "") {
      const title = TITLE.exec(line);
      if (title) {
        tree.title = (title[1] ?? "az").trim();
        tree.summary = (title[2] ?? "").trim();
        continue;
      }
    }

    const entry = ENTRY.exec(line);
    if (entry) {
      const item: AzHelpEntry = { name: entry[1] ?? "", summary: (entry[2] ?? "").trim() };
      if (section.startsWith("subgroup")) tree.groups.push(item);
      else if (section.startsWith("command")) tree.commands.push(item);
      last = item;
      continue;
    }

    if (last && /^\s{6,}\S/.test(line)) {
      last.summary = `${last.summary} ${line.trim()}`.trim();
    }
  }

  return tree;
}
