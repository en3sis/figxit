import { homedir } from "node:os";
import { join } from "node:path";
import { execute } from "./generators";

type Spec = Record<string, any>;
type Merge = (base: Spec, diff: Spec) => Spec;

const VERSION_MS = 5000;
const PATH = /^[\w@.+-]+(\/[\w@.+-]+)*$/;

const detecting = new Map<string, Promise<string | undefined>>();
const detected = new Map<string, string | undefined>();

function list(value: unknown): any[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function shareName(a: Spec, b: Spec): boolean {
  const names = new Set(list(a.name));
  return list(b.name).some((name) => names.has(name));
}

function mergeList(base: unknown, diff: unknown, merge: Merge): Spec[] {
  const entries = list(base);
  const used = new Set<number>();
  const out: Spec[] = [];
  for (const item of list(diff)) {
    const at = entries.findIndex((entry, index) => !used.has(index) && shareName(entry, item));
    if (at === -1) {
      if (!item.remove) out.push(item);
      continue;
    }
    used.add(at);
    if (!("remove" in item)) out.push(merge(entries[at], item));
  }
  entries.forEach((entry, index) => {
    if (!used.has(index)) out.push(entry);
  });
  return out;
}

function mergeArgs(base: unknown, diff: unknown): Spec[] {
  const entries = list(base);
  return list(diff)
    .filter((arg) => !arg.remove)
    .map((arg, index) => ({ ...entries[index], ...arg }));
}

function mergeOption(base: Spec, diff: Spec): Spec {
  const out = { ...base, ...diff };
  if (diff.args) out.args = mergeArgs(base.args, diff.args);
  return out;
}

function mergeCommand(base: Spec, diff: Spec): Spec {
  const out = { ...base, ...diff };
  if (diff.subcommands) out.subcommands = mergeList(base.subcommands, diff.subcommands, mergeCommand);
  if (diff.options) out.options = mergeList(base.options, diff.options, mergeOption);
  if (diff.args) out.args = mergeArgs(base.args, diff.args);
  return out;
}

function order(a: string, b: string): number {
  try {
    return Bun.semver.order(a, b);
  } catch {
    return a.localeCompare(b);
  }
}

export function applyVersions(spec: Spec, versions: unknown, version: string | undefined): Spec {
  if (!versions || typeof versions !== "object") return spec;
  const steps = Object.keys(versions)
    .filter((key) => version === undefined || order(key, version) <= 0)
    .sort(order);
  return steps.reduce((current, key) => mergeCommand(current, (versions as Record<string, Spec>)[key]!), spec);
}

function detect(name: string, index: Spec): Promise<string | undefined> {
  let pending = detecting.get(name);
  if (pending) return pending;
  const run = (request: unknown) => execute(request, homedir(), VERSION_MS);
  pending = (async () => {
    try {
      const version = typeof index.getVersionCommand === "function" ? await index.getVersionCommand(run) : undefined;
      return typeof version === "string" && version !== "" ? version : undefined;
    } catch {
      return undefined;
    }
  })();
  pending.then((version) => detected.set(name, version));
  detecting.set(name, pending);
  return pending;
}

export async function loadVersioned(name: string, dir: string, detectedLater: () => void): Promise<Spec | null> {
  const index = await import(join(dir, name, "index.js"));
  if (typeof index.default !== "function") return null;
  const known = detected.has(name);
  const version = detected.get(name);
  if (!known) {
    detect(name, index).then((found) => {
      if (found !== undefined) detectedLater();
    });
  }
  const picked = await index.default(version);
  const path = picked?.versionedSpecPath;
  if (typeof path !== "string" || !PATH.test(path) || !path.startsWith(`${name}/`)) return null;
  const file = await import(join(dir, `${path}.js`));
  return file.default && typeof file.default === "object" ? applyVersions(file.default, file.versions, version) : null;
}
