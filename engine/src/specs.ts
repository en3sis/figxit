import { join } from "node:path";
import { brandIcon, ICONS, type Icon } from "./brands";
import { specsDir } from "./paths";
import type { Candidate } from "./sources";

export type Spec = Record<string, any>;
export type Template = "filepaths" | "folders";

export interface Position {
  command: string;
  node: Spec;
  path: Spec[];
  used: Set<string>;
  optionArg: Spec | null;
  arg: Spec | null;
  allowSubcommands: boolean;
  afterDashes: boolean;
  repeated: boolean;
}

export interface Emitted {
  statics: Candidate[];
  generators: Spec[];
  templates: Set<Template>;
}

const MAX_DETAIL = 64;
const CONTROL = /[\x00-\x1f]/;
const NAME = /^[\w@.+-]+(\/[\w@.+-]+)*$/;

const modules = new Map<string, Promise<Spec | null>>();
let directory: string | null | undefined;
let names: Promise<Set<string>> | null = null;

async function specNames(dir: string): Promise<Set<string>> {
  names ??= import(join(dir, "index.js")).then(
    (mod) => new Set<string>(mod.default),
    () => new Set<string>(),
  );
  return names;
}

export function registerSpec(name: string, spec: Spec | null) {
  modules.set(name, Promise.resolve(spec));
}

export function loadSpec(name: string): Promise<Spec | null> {
  const hit = modules.get(name);
  if (hit) return hit;
  const loading = (async () => {
    if (!NAME.test(name)) return null;
    if (directory === undefined) directory = specsDir();
    if (!directory || !(await specNames(directory)).has(name)) return null;
    try {
      const spec = (await import(join(directory, `${name}.js`))).default;
      return spec && typeof spec === "object" ? (spec as Spec) : null;
    } catch {
      return null;
    }
  })();
  modules.set(name, loading);
  return loading;
}

export function list<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function namesOf(node: Spec | string): string[] {
  if (typeof node === "string") return [node];
  return list(node.name).filter((name): name is string => typeof name === "string" && name !== "");
}

function findOption(path: Spec[], name: string): Spec | null {
  for (let i = path.length - 1; i >= 0; i--) {
    for (const option of list<Spec>(path[i]!.options)) {
      if ((i === path.length - 1 || option.isPersistent) && namesOf(option).includes(name)) return option;
    }
  }
  return null;
}

export async function locate(spec: Spec, words: string[]): Promise<Position> {
  let node = spec;
  const path = [spec];
  const used = new Set<string>();
  let argIndex = 0;
  let positional = false;
  let pending: Spec[] = [];
  let variadicTaken = false;
  let afterDashes = false;
  let repeated = false;

  for (const word of words.slice(1)) {
    const optionLike = !afterDashes && word.startsWith("-") && word !== "-";
    if (pending.length) {
      const arg = pending[0]!;
      if (!(optionLike && (arg.isOptional || variadicTaken))) {
        if (arg.isVariadic) variadicTaken = true;
        else pending.shift();
        continue;
      }
      pending = [];
    }
    if (optionLike) {
      if (word === "--") {
        afterDashes = true;
        continue;
      }
      const equals = word.indexOf("=");
      const name = equals > 0 ? word.slice(0, equals) : word;
      const option = findOption(path, name);
      used.add(name);
      if (option) {
        for (const alias of namesOf(option)) used.add(alias);
        if (equals < 0) {
          pending = list<Spec>(option.args).slice();
          variadicTaken = false;
        }
      }
      continue;
    }
    if (!positional) {
      let sub = list<Spec>(node.subcommands).find((candidate) => namesOf(candidate).includes(word));
      if (sub) {
        if (typeof sub.loadSpec === "string") {
          const loaded = await loadSpec(sub.loadSpec);
          if (loaded) sub = { ...sub, ...loaded, name: sub.name };
        }
        node = sub;
        path.push(sub);
        argIndex = 0;
        continue;
      }
    }
    positional = true;
    const arg = list<Spec>(node.args)[argIndex];
    if (arg && !arg.isVariadic) argIndex++;
    else if (arg) repeated = true;
  }

  return {
    command: words[0]!,
    node,
    path,
    used,
    optionArg: pending[0] ?? null,
    arg: list<Spec>(node.args)[argIndex] ?? null,
    allowSubcommands: !positional,
    afterDashes,
    repeated: repeated && pending.length === 0,
  };
}

function detailOf(item: Spec, fallback: string): string {
  const text = typeof item.description === "string" ? item.description.split("\n")[0]!.trim() : "";
  if (!text) return fallback;
  return text.length > MAX_DETAIL ? text.slice(0, MAX_DETAIL - 1) + "…" : text;
}

function hintIcon(item: Spec, fallback: Icon): Icon {
  if (item.type === "folder") return ICONS.folder;
  if (item.type === "file") return ICONS.file;
  const hint = typeof item.icon === "string" ? item.icon : "";
  if (hint.includes("type=git")) return ICONS.branch;
  if (hint.includes("\u{1F3F7}")) return ICONS.tag;
  return fallback;
}

function pickName(aliases: string[], prefix: string): string {
  const matching = prefix ? aliases.filter((name) => name.startsWith(prefix)) : aliases;
  const pool = matching.length ? matching : aliases;
  return pool.reduce((best, name) => (name.length > best.length ? name : best));
}

export function toCandidate(
  item: Spec | string | null | undefined,
  fallback: Icon,
  kind: string,
  prefix = "",
): Candidate | null {
  if (item === null || item === undefined) return null;
  const node: Spec = typeof item === "string" ? { name: item } : item;
  const aliases = namesOf(node);
  if (aliases.length === 0 || node.hidden || node.deprecated) return null;
  const name = kind === "subcommand" ? pickName(aliases, prefix) : aliases[0]!;
  const label = typeof node.displayName === "string" && node.displayName ? node.displayName : name;
  if (typeof node.type === "string" && node.type !== "arg" && node.type !== "special") kind = node.type;
  const priority = typeof node.priority === "number" ? node.priority : 50;
  const candidate: Candidate = {
    label,
    detail: detailOf(node, kind),
    score: Math.min(Math.max(priority, 1), 100) / 50,
    aliases,
    ...hintIcon(node, fallback),
  };
  if (typeof node.insertValue === "string") {
    const value = node.insertValue.replace("{cursor}", "");
    if (value && !CONTROL.test(value)) candidate.insert = value;
  }
  if (candidate.insert === undefined && label !== name) candidate.insert = `${name} `;
  const first = list<Spec>(node.args)[0];
  if (node.isDangerous || (first && !first.isOptional)) candidate.hold = true;
  return candidate;
}

function optionCandidate(option: Spec, prefix: string): Candidate | null {
  const aliases = namesOf(option);
  if (aliases.length === 0 || option.hidden || option.deprecated) return null;
  const long = prefix.startsWith("--") ? aliases.find((name) => name.startsWith("--")) : undefined;
  const label = long ?? aliases[0]!;
  const separator = option.requiresSeparator
    ? typeof option.requiresSeparator === "string"
      ? option.requiresSeparator
      : "="
    : " ";
  const priority = typeof option.priority === "number" ? option.priority : 50;
  const candidate: Candidate = {
    label,
    detail: detailOf(option, "option"),
    score: Math.min(Math.max(priority, 1), 100) / 50,
    aliases,
    insert: label + separator,
    ...ICONS.flag,
  };
  const first = list<Spec>(option.args)[0];
  if (option.isDangerous || (first && !first.isOptional)) candidate.hold = true;
  return candidate;
}

export function emit(position: Position, prefix: string): Emitted {
  const out: Emitted = { statics: [], generators: [], templates: new Set() };
  const brand = brandIcon(position.command) ?? ICONS.command;
  const push = (candidate: Candidate | null) => {
    if (candidate) out.statics.push(candidate);
  };
  const addTemplates = (value: unknown) => {
    for (const template of list(value as string | string[])) {
      if (template === "filepaths" || template === "folders") out.templates.add(template);
    }
  };
  const addArg = (arg: Spec) => {
    const label = typeof arg.name === "string" && arg.name ? arg.name : "argument";
    for (const suggestion of list<Spec | string>(arg.suggestions)) push(toCandidate(suggestion, brand, label));
    addTemplates(arg.template);
    for (const generator of list<Spec>(arg.generators)) {
      if (generator.template) addTemplates(generator.template);
      else if (!arg.debounce) out.generators.push(generator);
    }
  };

  if (position.optionArg) {
    addArg(position.optionArg);
    if (!position.optionArg.isOptional) return out;
  }

  if (prefix.startsWith("-") && !position.afterDashes) {
    const last = position.path.length - 1;
    position.path.forEach((node, index) => {
      for (const option of list<Spec>(node.options)) {
        if (index !== last && !option.isPersistent) continue;
        if (!option.isRepeatable && namesOf(option).some((name) => position.used.has(name))) continue;
        push(optionCandidate(option, prefix));
      }
    });
    return out;
  }

  if (position.allowSubcommands) {
    for (const sub of list<Spec>(position.node.subcommands)) push(toCandidate(sub, brand, "subcommand", prefix));
  }
  if (position.arg) addArg(position.arg);
  for (const extra of list<Spec | string>(position.node.additionalSuggestions)) {
    push(toCandidate(extra, brand, "suggestion"));
  }
  return out;
}
