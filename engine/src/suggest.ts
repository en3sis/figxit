import { brandIcon, ICONS, type Icon } from "./brands";
import { fileCandidates, lookup, type GenContext, type Lookup } from "./generators";
import type { History } from "./history";
import { projectCandidates, repoRoot, type Candidate } from "./sources";
import { emit, loadSpec, locate, toCandidate, type Emitted } from "./specs";
import { commandWords, keyword, RESERVED, scan } from "./tokenize";
import { CAUTION, cautious } from "./verbs";

export interface Suggestion {
  items: Candidate[];
  remove: number;
  tokenStart: number;
  lead?: number;
}

export interface Result {
  now: Suggestion | null;
  more: Promise<Suggestion | null> | null;
}

const MAX_ITEMS = 40;
const MAX_TOKEN = 48;
const UNSAFE = /['"`$\\*?<>!{}\[\]]/;
const SHELL = /['"`$\\*?<>!{}\[\];&|()\n]/;
const BARE = /[\s#]/;
const SECRET =
  /(key|token|secret|passwd|password|pass|pwd|pw|auth|bearer|credential)s?(?![a-z])[\w.-]*[=:]|:\/\/[^\/@\s]+:[^@\s]+@|^(gh[pousr]_|github_pat_|sk-|xox[abprs]-|AKIA|eyJ)|^[A-Za-z0-9+_=-]{32,}$/i;
const SECRET_FLAG = /^(-[pua]|--?(password|passwd|pass|token|secret|key|apikey|api-key|auth|bearer|user))$/i;

export function secretLike(token: string, previous?: string): boolean {
  return SECRET.test(token) || (previous !== undefined && SECRET_FLAG.test(previous));
}
const EMPTY: Result = { now: null, more: null };

export function matchScore(label: string, prefix: string): number {
  if (prefix === "") return 1;
  const a = label.toLowerCase();
  const b = prefix.toLowerCase();
  if (a.startsWith(b)) return label.startsWith(prefix) ? 1 : 0.9;
  if (a.includes(b)) return 0.45;
  let index = 0;
  for (const c of a) {
    if (c === b[index]) index++;
    if (index === b.length) return 0.2;
  }
  return 0;
}

function pathLike(token: string): boolean {
  return token.includes("/") || token.startsWith(".") || token.startsWith("~");
}

function iconFor(label: string, depth: number, command: string | undefined): Icon {
  if (depth === 0) return brandIcon(label) ?? (label === "make" ? ICONS.target : ICONS.command);
  if (label.startsWith("-")) return ICONS.flag;
  if (pathLike(label)) return label.endsWith("/") ? ICONS.folder : ICONS.file;
  return brandIcon(command) ?? ICONS.history;
}

const COMMAND = /^[\w.+-]+$/;

export async function suggest(
  buffer: string,
  cursor: number,
  cwd: string,
  history: History,
  now = Date.now(),
): Promise<Result> {
  const base = await complete(buffer, cursor, cwd, history, now);
  const head = buffer.slice(0, cursor);
  if (cursor !== buffer.length || !COMMAND.test(head) || keyword(head) || !(await loadSpec(head))) return base;

  const next = await complete(`${head} `, cursor + 1, cwd, history, now);
  const ahead = (list: Suggestion | null): Suggestion | null => {
    const rows = (list?.items ?? [])
      .filter((item) => item.pick && !item.run && !item.label.startsWith("-"))
      .filter((item) => item.icon !== ICONS.folder.icon && item.icon !== ICONS.file.icon)
      .map((item) => ({ ...item, insert: ` ${item.insert ?? `${item.label} `}` }));
    if (rows.length === 0) return null;
    const run: Candidate = { label: head, detail: "Run", score: 0, icon: "sf:return", tint: "3A3A3C", run: true };
    return { items: [run, ...rows].slice(0, MAX_ITEMS), remove: 0, tokenStart: cursor, lead: 1 };
  };
  const first = ahead(next.now);
  if (first) return { now: first, more: next.more ? next.more.then((list) => ahead(list) ?? first) : null };
  if (!next.more) return base;
  return {
    now: base.now,
    more: next.more.then(async (list) => ahead(list) ?? (base.more ? await base.more : base.now)),
  };
}

async function complete(
  buffer: string,
  cursor: number,
  cwd: string,
  history: History,
  now: number,
): Promise<Result> {
  const after = buffer[cursor];
  if (after !== undefined && after !== " " && after !== "\n") return EMPTY;

  const parsed = scan(buffer.slice(0, cursor));
  if (parsed.quoted) return EMPTY;
  const words = commandWords(parsed.segments[parsed.segments.length - 1]!);
  const prefix = parsed.prefix;
  const depth = words.length;
  if (depth === 0 && prefix === "") return EMPTY;
  if (UNSAFE.test(prefix)) return EMPTY;

  const command = words[0];
  const spec = command && !command.includes("/") ? await loadSpec(command) : null;
  const project = projectCandidates(words, prefix, cwd, spec !== null);
  const position = spec ? await locate(spec, words) : null;
  if (position?.repeated && prefix === "") return EMPTY;
  const emitted: Emitted | null = position ? emit(position, prefix) : null;
  const stats = history.nextTokens(words, cwd, repoRoot(cwd), now);
  const known = depth === 0 && prefix !== "" && !prefix.includes("/") && !keyword(prefix) && (await loadSpec(prefix)) !== null;
  const covered = project.authoritative || spec !== null;
  const brand = brandIcon(command) ?? ICONS.command;

  const files: Candidate[] = [];
  const slots: Lookup[] = [];
  if (emitted && !project.authoritative) {
    if (emitted.templates.size > 0) {
      files.push(...fileCandidates(prefix, cwd, !emitted.templates.has("filepaths")));
    }
    if (project.candidates.length === 0 && ![...words, prefix].some((word) => SHELL.test(word) || BARE.test(word))) {
      const ctx: GenContext = { tokens: [...words, prefix], cwd, prefix };
      for (const generator of emitted.generators) slots.push(lookup(generator, ctx, now));
    }
  }

  const assemble = (dynamic: unknown[]): Suggestion | null => {
    const merged = new Map<string, Candidate>();
    const add = (candidate: Candidate | null) => {
      if (candidate && !merged.has(candidate.label)) merged.set(candidate.label, { ...candidate });
    };
    const pick = (candidate: Candidate) => add({ ...candidate, pick: true });
    project.candidates.forEach(pick);
    emitted?.statics.forEach(pick);
    for (const item of dynamic) {
      const candidate = toCandidate(item as never, brand, "suggestion");
      if (!candidate) continue;
      if (candidate.icon === ICONS.folder.icon || candidate.icon === ICONS.file.icon) {
        const dotted = candidate.label.startsWith(".") && !candidate.label.startsWith("../");
        if (dotted && !prefix.startsWith(".")) continue;
        candidate.score = Math.min(candidate.score, 0.65);
      } else if (cautious(candidate.label)) {
        candidate.tint = CAUTION;
      }
      pick(candidate);
    }
    files.forEach(pick);

    const claimed = new Set<string>();
    for (const candidate of merged.values()) {
      for (const name of candidate.aliases ?? [candidate.label]) {
        const stat = stats.get(name);
        if (!stat || claimed.has(name)) continue;
        claimed.add(name);
        candidate.score += stat.score;
      }
    }

    for (const [token, stat] of stats) {
      if (claimed.has(token) || project.authoritative) continue;
      if (covered && stat.local === 0) continue;
      if (token.length > MAX_TOKEN || SHELL.test(token) || BARE.test(token)) continue;
      if (secretLike(token, words[depth - 1])) continue;
      if (token.startsWith("-") !== prefix.startsWith("-")) continue;
      if (pathLike(token) && stat.local === 0) continue;
      if (depth === 0 && (stat.count < 2 || RESERVED.has(token))) continue;
      add({
        label: token,
        detail: depth === 0 ? "command" : "history",
        pick: depth === 0,
        score: stat.score,
        ...iconFor(token, depth, command),
      });
    }

    let exact: Candidate | undefined;
    if (prefix !== "") {
      for (const candidate of merged.values()) {
        if (candidate.label === prefix || candidate.aliases?.includes(prefix)) {
          exact = candidate;
          break;
        }
      }
    }
    if (!exact && known) exact = { label: prefix, detail: "", score: 0 };
    if (exact?.hold) return null;

    let items: Candidate[] = [];
    let prefixed = false;
    const matches = new Map<Candidate, number>();
    for (const candidate of merged.values()) {
      if (candidate === exact) continue;
      if (depth === 0 && candidate.label !== prefix && candidate.label.toLowerCase() === prefix.toLowerCase()) continue;
      if (candidate.insert === undefined && (candidate.label === prefix || UNSAFE.test(candidate.label))) continue;
      let match = matchScore(candidate.label, prefix);
      for (const name of candidate.aliases ?? []) match = Math.max(match, matchScore(name, prefix));
      if (match === 0 || (depth === 0 && match < 0.9)) continue;
      const item = { ...candidate, score: candidate.score * match };
      if (match >= 0.9) prefixed = true;
      matches.set(item, match);
      items.push(item);
    }
    if (prefix !== "" && (prefixed || exact)) items = items.filter((item) => matches.get(item)! >= 0.9);
    if (items.length === 0 && !exact) return null;

    items.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    if (exact) items.unshift({ label: prefix, detail: "Run", score: 0, icon: "sf:return", tint: "3A3A3C", run: true });
    return { items: items.slice(0, MAX_ITEMS), remove: cursor - parsed.tokenStart, tokenStart: parsed.tokenStart };
  };

  const cached = slots.flatMap((slot) => slot.value ?? []);
  const pending = slots.some((slot) => slot.refresh);
  return {
    now: assemble(cached),
    more: pending
      ? Promise.all(slots.map((slot) => slot.refresh ?? slot.value ?? [])).then((lists) => assemble(lists.flat()))
      : null,
  };
}
