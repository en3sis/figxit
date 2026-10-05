import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ICONS } from "./brands";
import { verbIcon } from "./verbs";

export interface Candidate {
  label: string;
  detail: string;
  score: number;
  icon?: string;
  tint?: string;
  insert?: string;
  aliases?: string[];
}

export interface SourceResult {
  candidates: Candidate[];
  authoritative: boolean;
}

const MAKEFILES = ["GNUmakefile", "makefile", "Makefile"];
const TARGET = /^([A-Za-z0-9][A-Za-z0-9_.\/-]*)\s*:(?![=:])(.*)$/;
const SECTION = /^##@\s*(.+)$/;
const MAX_DETAIL = 64;
const BRANCH_COMMANDS = new Set(["checkout", "switch", "merge", "rebase", "cherry-pick"]);
const SCRIPT_RUNNERS: Record<string, number[]> = { npm: [2], pnpm: [1, 2], yarn: [1, 2], bun: [1, 2] };

const fileCache = new Map<string, { mtime: number; value: Candidate[] }>();
const rootCache = new Map<string, string | null>();
const branchCache = new Map<string, { at: number; value: Candidate[] }>();

function cached(path: string, build: (text: string) => Candidate[]): Candidate[] {
  try {
    const stat = statSync(path);
    if (stat.size > 512 * 1024) return [];
    const hit = fileCache.get(path);
    if (hit && hit.mtime === stat.mtimeMs) return hit.value;
    const value = build(readFileSync(path, "utf8"));
    fileCache.set(path, { mtime: stat.mtimeMs, value });
    return value;
  } catch {
    return [];
  }
}

function describe(section: string, help: string): string {
  const text = section && help ? `${section} · ${help}` : section || help || "make target";
  return text.length > MAX_DETAIL ? text.slice(0, MAX_DETAIL - 1) + "…" : text;
}

export function parseMakefile(text: string): Candidate[] {
  const seen = new Map<string, Candidate>();
  let section = "";
  for (const line of text.split("\n")) {
    const header = SECTION.exec(line);
    if (header) {
      section = header[1]!.trim();
      continue;
    }
    const match = TARGET.exec(line);
    if (!match || match[1]!.includes("%")) continue;
    const help = /##\s*(.+)$/.exec(match[2]!)?.[1]!.trim() ?? "";
    const existing = seen.get(match[1]!);
    if (existing) {
      if (help) existing.detail = describe(section, help);
      continue;
    }
    seen.set(match[1]!, { label: match[1]!, detail: describe(section, help), score: 1, ...verbIcon(match[1]!) });
  }
  return [...seen.values()];
}

export function parseScripts(text: string): Candidate[] {
  try {
    const scripts = JSON.parse(text).scripts;
    if (!scripts || typeof scripts !== "object") return [];
    return Object.entries(scripts)
      .filter(([, body]) => typeof body === "string")
      .map(([name, body]) => {
        const command = body as string;
        return {
          label: name,
          detail: command.length > 48 ? command.slice(0, 47) + "…" : command,
          score: 1,
          ...verbIcon(name),
        };
      });
  } catch {
    return [];
  }
}

export function repoRoot(cwd: string): string | null {
  const hit = rootCache.get(cwd);
  if (hit !== undefined) return hit;
  let dir = cwd;
  let root: string | null = null;
  for (;;) {
    if (existsSync(join(dir, ".git"))) {
      root = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  rootCache.set(cwd, root);
  return root;
}

function branches(cwd: string): Candidate[] {
  const root = repoRoot(cwd);
  if (!root) return [];
  const hit = branchCache.get(root);
  if (hit && Date.now() - hit.at < 3000) return hit.value;
  let value: Candidate[] = [];
  try {
    const result = Bun.spawnSync(
      ["git", "for-each-ref", "--sort=-committerdate", "--count=60", "--format=%(refname:short)", "refs/heads"],
      { cwd: root, stdout: "pipe", stderr: "ignore" },
    );
    const names = result.stdout.toString().split("\n").filter(Boolean);
    value = names.map((label, index) => ({
      label,
      detail: "branch",
      score: 1 + (names.length - index) / names.length,
      ...ICONS.branch,
    }));
  } catch {}
  branchCache.set(root, { at: Date.now(), value });
  return value;
}

export function projectCandidates(words: string[], prefix: string, cwd: string, hasSpec = false): SourceResult {
  const command = words[0];
  const depth = words.length;
  const none = { candidates: [], authoritative: false };
  if (!command || prefix.startsWith("-")) return none;

  if (command === "make" && depth >= 1) {
    for (const name of MAKEFILES) {
      const path = join(cwd, name);
      if (existsSync(path)) return { candidates: cached(path, parseMakefile), authoritative: true };
    }
    return none;
  }

  const runner = SCRIPT_RUNNERS[command];
  if (runner && runner.includes(depth) && (depth === 1 || words[1] === "run" || words[1] === "run-script")) {
    const path = join(cwd, "package.json");
    if (!existsSync(path)) return none;
    return { candidates: cached(path, parseScripts), authoritative: depth === 2 };
  }

  if (!hasSpec && command === "git" && depth === 2 && BRANCH_COMMANDS.has(words[1]!)) {
    return { candidates: branches(cwd), authoritative: true };
  }

  return none;
}
