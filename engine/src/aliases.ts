import { commandWords, scan } from "./tokenize";

export function parseAliases(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/[\x1e\n]/)) {
    const entry = line.startsWith("abbr ") ? abbreviation(line) : assignment(line);
    if (entry) map.set(entry[0], entry[1]);
  }
  return map;
}

function assignment(line: string): [string, string] | null {
  const at = line.indexOf("=");
  return at > 0 ? [line.slice(0, at), line.slice(at + 1)] : null;
}

function abbreviation(line: string): [string, string] | null {
  const parsed = scan(line);
  if (parsed.quoted || parsed.segments.length !== 1) return null;
  const words = [...parsed.segments[0]!, parsed.prefix];
  const end = words.indexOf("--");
  if (end < 0 || words.length !== end + 3) return null;
  if (words.slice(1, end).some((word) => word !== "-a" && word !== "--add")) return null;
  return [words[end + 1]!, words[end + 2]!];
}

export function expandCommandWords(words: string[], aliases?: Map<string, string>): string[] {
  let current = words;
  const seen = new Set<string>();
  while (aliases && current.length > 0) {
    const first = current[0]!;
    const target = aliases.get(first);
    if (target === undefined || seen.has(first)) break;
    seen.add(first);
    const parsed = scan(target);
    if (parsed.quoted || parsed.segments.length !== 1) break;
    const expanded = parsed.prefix ? [...parsed.segments[0]!, parsed.prefix] : parsed.segments[0]!;
    const next = commandWords([...expanded, ...current.slice(1)]);
    if (next.length === 0) break;
    current = next;
  }
  return current;
}
