import { readdirSync, readFileSync, rmSync, statSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import { SHELL_ALIASES, trusted, userAliasesFile } from "./paths";
import { commandWords, scan } from "./tokenize";

export interface Aliases {
  get(name: string): string | undefined;
}

const PID = /^[1-9]\d*$/;
const MAX_BYTES = 1 << 20;
const NONE: ReadonlyMap<string, string> = new Map();
let user: { path: string; stamp: string; aliases: ReadonlyMap<string, string> } | null = null;

export function parseAliases(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const entry = line.startsWith("abbr ") ? abbreviation(line) : assignment(line);
    if (entry) map.set(entry[0], entry[1]);
  }
  return map;
}

export function parseAliasFile(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const entry = line.startsWith("abbr ") ? abbreviation(line) : definition(line);
    if (entry) map.set(entry[0], entry[1]);
  }
  return map;
}

function wordsOf(line: string): string[] | null {
  const parsed = scan(line);
  if (parsed.quoted || parsed.segments.length !== 1) return null;
  return parsed.prefix ? [...parsed.segments[0]!, parsed.prefix] : parsed.segments[0]!;
}

function assignment(line: string): [string, string] | null {
  const at = line.indexOf("=");
  return at > 0 ? [line.slice(0, at), line.slice(at + 1)] : null;
}

function definition(line: string): [string, string] | null {
  const words = wordsOf(line);
  if (!words) return null;
  const named = words[0] === "alias";
  const rest = named ? words.slice(1) : words;
  const first = rest[0];
  if (!first || first.startsWith("-")) return null;
  const at = first.indexOf("=");
  if (at > 0) return [first.slice(0, at), [first.slice(at + 1), ...rest.slice(1)].join(" ")];
  return named && at < 0 && rest.length === 2 ? [first, rest[1]!] : null;
}

function abbreviation(line: string): [string, string] | null {
  const words = wordsOf(line);
  if (!words) return null;
  const end = words.indexOf("--");
  if (end < 0 || words.length !== end + 3) return null;
  if (words.slice(1, end).some((word) => word !== "-a" && word !== "--add")) return null;
  return [words[end + 1]!, words[end + 2]!];
}

function owned(stat: Stats): boolean {
  const uid = process.getuid?.();
  return uid === undefined || stat.uid === uid;
}

function stampOf(path: string, allowed: (stat: Stats, path: string) => boolean): string | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_BYTES || !allowed(stat, path) || !trusted(statSync(dirname(path)), dirname(path))) return null;
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

function read(path: string, parse: (text: string) => Map<string, string>): ReadonlyMap<string, string> {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    return NONE;
  }
}

export function shellAliases(pid: string): ReadonlyMap<string, string> {
  if (!PID.test(pid)) return NONE;
  const path = join(SHELL_ALIASES, pid);
  return stampOf(path, owned) ? read(path, parseAliases) : NONE;
}

export function userAliases(): ReadonlyMap<string, string> {
  const path = userAliasesFile();
  const stamp = stampOf(path, trusted);
  if (!stamp) {
    user = null;
    return NONE;
  }
  if (user?.path !== path || user.stamp !== stamp) user = { path, stamp, aliases: read(path, parseAliasFile) };
  return user.aliases;
}

export function aliasesFor(shell: ReadonlyMap<string, string>): Aliases {
  const mine = userAliases();
  return mine.size === 0 ? shell : { get: (name) => mine.get(name) ?? shell.get(name) };
}

export function sweepAliases(): void {
  let names: string[];
  try {
    names = readdirSync(SHELL_ALIASES);
  } catch {
    return;
  }
  for (const name of names) {
    if (PID.test(name) && !running(Number(name))) rmSync(join(SHELL_ALIASES, name), { force: true });
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

export function expandCommandWords(words: string[], aliases?: Aliases): string[] {
  let current = words;
  const seen = new Set<string>();
  while (aliases && current.length > 0) {
    const first = current[0]!;
    const target = aliases.get(first);
    if (target === undefined || seen.has(first)) break;
    seen.add(first);
    const expanded = wordsOf(target);
    if (!expanded) break;
    const next = commandWords([...expanded, ...current.slice(1)]);
    if (next.length === 0) break;
    current = next;
  }
  return current;
}
