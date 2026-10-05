import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ICONS } from "./brands";
import { resolveCommand } from "./paths";
import type { Candidate } from "./sources";
import type { Spec } from "./specs";

export interface GenContext {
  tokens: string[];
  cwd: string;
  prefix: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

export interface Lookup {
  value?: unknown[];
  refresh?: Promise<unknown[]>;
}

const DEFAULT_TTL = 3000;
const SCRIPT_TIMEOUT = 1500;
const CUSTOM_TIMEOUT = 2500;
const MAX_ENTRIES = 300;
const MAX_FILES = 300;
const ESCAPE = /([ \\'"`$&|;()<>*?!#\[\]{}])/g;

const cache = new Map<string, { at: number; value: unknown[] }>();
const running = new Map<string, Promise<unknown[]>>();
const ids = new WeakMap<object, number>();
let nextId = 1;

export async function execute(input: unknown, cwd: string, timeout = SCRIPT_TIMEOUT): Promise<ExecResult> {
  const failed = { stdout: "", stderr: "", status: 1 };
  let cmd: string[];
  let env: Record<string, string | undefined> = process.env;
  if (typeof input === "string") {
    cmd = ["sh", "-c", input];
  } else if (Array.isArray(input)) {
    cmd = input.map(String);
  } else if (input && typeof input === "object" && typeof (input as Spec).command === "string") {
    const request = input as Spec;
    cmd = [request.command, ...(Array.isArray(request.args) ? request.args.map(String) : [])];
    if (typeof request.cwd === "string") cwd = request.cwd;
    if (request.env && typeof request.env === "object") env = { ...process.env, ...request.env };
    if (typeof request.timeout === "number") timeout = request.timeout;
  } else {
    return failed;
  }
  if (cmd.length === 0 || !cmd[0]) return failed;
  try {
    cmd[0] = resolveCommand(cmd[0]);
    const proc = Bun.spawn(cmd, { cwd, env: { ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeout);
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), status };
  } catch {
    return failed;
  }
}

function limit<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

async function run(generator: Spec, ctx: GenContext): Promise<unknown[]> {
  try {
    if (typeof generator.custom === "function") {
      const result = await limit(
        Promise.resolve(
          generator.custom(ctx.tokens, (input: unknown) => execute(input, ctx.cwd), {
            currentWorkingDirectory: ctx.cwd,
            currentProcess: "zsh",
            sshPrefix: "",
            environmentVariables: process.env,
            searchTerm: ctx.prefix,
            isDangerous: false,
          }),
        ),
        CUSTOM_TIMEOUT,
        [],
      );
      return Array.isArray(result) ? result : [];
    }
    const script = typeof generator.script === "function" ? generator.script(ctx.tokens) : generator.script;
    if (!script) return [];
    const timeout = typeof generator.scriptTimeout === "number" ? generator.scriptTimeout : SCRIPT_TIMEOUT;
    const { stdout } = await execute(script, ctx.cwd, timeout);
    if (typeof generator.postProcess === "function") {
      const result = generator.postProcess(stdout, ctx.tokens);
      return Array.isArray(result) ? result : [];
    }
    if (typeof generator.splitOn === "string") {
      return stdout
        .split(generator.splitOn)
        .filter(Boolean)
        .map((name) => ({ name }));
    }
    return [];
  } catch {
    return [];
  }
}

function keyOf(generator: Spec, ctx: GenContext): string {
  let id = ids.get(generator);
  if (!id) {
    id = nextId++;
    ids.set(generator, id);
  }
  const scope = generator.trigger ? ctx.prefix.slice(0, ctx.prefix.lastIndexOf("/") + 1) : "";
  return [id, ctx.cwd, ctx.tokens.slice(0, -1).join(" "), scope].join("\0");
}

export function lookup(generator: Spec, ctx: GenContext, now = Date.now()): Lookup {
  const key = keyOf(generator, ctx);
  const hit = cache.get(key);
  const ttl = typeof generator.cache?.ttl === "number" ? generator.cache.ttl : DEFAULT_TTL;
  if (hit && now - hit.at < ttl) return { value: hit.value };

  let refresh = running.get(key);
  if (!refresh) {
    refresh = run(generator, ctx).then((value) => {
      running.delete(key);
      cache.delete(key);
      cache.set(key, { at: now, value });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      return value;
    });
    running.set(key, refresh);
  }
  return { value: hit?.value, refresh };
}

export function escapePath(path: string): string {
  const home = path.startsWith("~/") ? "~/" : "";
  return home + path.slice(home.length).replace(ESCAPE, "\\$1");
}

export function fileCandidates(prefix: string, cwd: string, foldersOnly: boolean): Candidate[] {
  const slash = prefix.lastIndexOf("/");
  const dirPart = prefix.slice(0, slash + 1);
  const base = prefix.slice(slash + 1);
  const dir = dirPart.startsWith("~/")
    ? join(homedir(), dirPart.slice(2))
    : dirPart.startsWith("/")
      ? dirPart
      : join(cwd, dirPart);
  const out: Candidate[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= MAX_FILES) break;
      if (entry.name.startsWith(".") && !base.startsWith(".")) continue;
      let folder = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          folder = statSync(join(dir, entry.name)).isDirectory();
        } catch {}
      }
      if (foldersOnly && !folder) continue;
      const label = dirPart + entry.name + (folder ? "/" : "");
      out.push({
        label,
        detail: folder ? "folder" : "file",
        score: folder ? 0.65 : 0.6,
        insert: escapePath(label) + (folder ? "" : " "),
        ...(folder ? ICONS.folder : ICONS.file),
      });
    }
  } catch {}
  return out;
}
