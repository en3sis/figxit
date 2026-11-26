import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, statSync, type Stats } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { dlopen, FFIType, read } from "bun:ffi";

const STATE = join(homedir(), ".local/state/figxit");

export const ENGINE_SOCK = process.env.FIGXIT_SOCK ?? join(STATE, "engine.sock");
export const HELPER_SOCK = process.env.FIGXIT_HELPER_SOCK ?? join(STATE, "helper.sock");
export const SHELL_ALIASES = join(dirname(ENGINE_SOCK), "aliases");

export function executable(): string {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

export function bundlePath(): string | null {
  return /^(.+\.app)\/Contents\/MacOS\//.exec(executable())?.[1] ?? null;
}

export function appPath(): string | null {
  const candidates = [
    process.env.FIGXIT_APP,
    bundlePath(),
    join(dirname(executable()), "Figxit.app"),
    join(import.meta.dir, "../../dist/Figxit.app"),
  ];
  return candidates.find((path) => path && existsSync(path)) ?? null;
}

function configDir(): string {
  return join(absolute(process.env.XDG_CONFIG_HOME) ?? join(homedir(), ".config"), "figxit");
}

export function userSpecsDir(): string {
  return process.env.FIGXIT_USER_SPECS ?? join(configDir(), "specs");
}

export function userAliasesFile(): string {
  return process.env.FIGXIT_USER_ALIASES ?? join(configDir(), "aliases");
}

export function trusted(stat: Stats, path: string): boolean {
  return trustProblem(stat, path) === null;
}

export function trustProblem(stat: Stats, path: string): string | null {
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid && stat.uid !== 0) return `${shown(path)} belongs to another user`;
  if (stat.mode & 0o002) return `${shown(path)} is writable by everyone`;
  if ((stat.mode & 0o020) === 0) return null;
  if (!ownGroup(stat.gid)) return `${shown(path)} is writable by group ${groupName(stat.gid)}`;
  const acl = aclState(path);
  if (acl === "set") return `${shown(path)} has an ACL that can let others write to it`;
  return acl === "unknown" ? `${shown(path)} is writable by its group, and its ACL can't be checked` : null;
}

const ACL = Buffer.from("system.posix_acl_access\0");
const ENODATA = 61;
let libc: ReturnType<typeof openLibc> | null | undefined;

function openLibc() {
  const getxattr = { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i64_fast } as const;
  return dlopen("libc.so.6", { getxattr, __errno_location: { args: [], returns: FFIType.ptr } }).symbols;
}

function aclState(path: string): "none" | "set" | "unknown" {
  if (libc === undefined) {
    try {
      libc = process.platform === "linux" ? openLibc() : null;
    } catch {
      libc = null;
    }
  }
  if (!libc) return "unknown";
  try {
    const name = Buffer.from(`${path}\0`);
    if (libc.getxattr(name, ACL, null, 0) >= 0) return "set";
    const errno = libc.__errno_location();
    return errno && read.i32(errno) === ENODATA ? "none" : "unknown";
  } catch {
    return "unknown";
  }
}

export function trustedPath(file: string, home = homedir()): string | null {
  const walked = walk(file, home);
  return "path" in walked ? walked.path : null;
}

export function fileProblem(file: string, home = homedir()): string | null {
  const walked = walk(file, home);
  if (!("path" in walked)) return walked.problem;
  try {
    const stat = statSync(walked.path);
    return stat.isFile() ? trustProblem(stat, walked.path) : `${shown(walked.path)} is not a file`;
  } catch {
    return `${shown(file)} can't be read`;
  }
}

function walk(file: string, home: string): { path: string } | { problem: string } {
  const given = new Set(lineage(real(home)));
  const parts = resolve(file).split("/").reverse();
  let path = "/";
  let links = 0;
  try {
    while (parts.length > 0) {
      const part = parts.pop();
      if (!part || part === ".") continue;
      if (part === "..") {
        path = dirname(path);
        continue;
      }
      if (!given.has(path)) {
        const folder = statSync(path);
        const problem = trustProblem(folder, path);
        if (problem && !(folder.uid === 0 && (folder.mode & 0o1000) !== 0)) return { problem };
      }
      const next = join(path, part);
      if (!lstatSync(next).isSymbolicLink()) {
        path = next;
        continue;
      }
      if (++links > 40) return { problem: `${shown(file)} goes through too many links` };
      const target = readlinkSync(next);
      parts.push(...target.split("/").reverse());
      if (target.startsWith("/")) path = "/";
    }
    return realpathSync(file) === path ? { path } : { problem: `${shown(file)} changed while it was checked` };
  } catch {
    return { problem: `${shown(file)} can't be read` };
  }
}

function shown(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function groupName(gid: number): string {
  try {
    const entry = readFileSync("/etc/group", "utf8")
      .split("\n")
      .map((line) => line.split(":"))
      .find((fields) => /^\d+$/.test(fields[2] ?? "") && Number(fields[2]) === gid);
    return entry?.[0] || String(gid);
  } catch {
    return String(gid);
  }
}

function lineage(path: string): string[] {
  const paths = [path];
  while (dirname(path) !== path) paths.push((path = dirname(path)));
  return paths;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

let ownGroups = { stamp: "", gids: new Map<number, boolean>() };

function fileStamp(path: string): string {
  const stat = statSync(path);
  return `${path}:${stat.ino}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}`;
}

export function ownGroup(gid: number, group = "/etc/group", passwd = "/etc/passwd"): boolean {
  let stamp: string;
  try {
    stamp = `${fileStamp(group)}\n${fileStamp(passwd)}`;
  } catch {
    return false;
  }
  if (ownGroups.stamp !== stamp) ownGroups = { stamp, gids: new Map() };
  let own = ownGroups.gids.get(gid);
  if (own === undefined) {
    try {
      own = privateGroup(gid, userInfo(), readFileSync(group, "utf8"), readFileSync(passwd, "utf8"));
    } catch {
      own = false;
    }
    ownGroups.gids.set(gid, own);
  }
  return own;
}

export function privateGroup(gid: number, user: { username: string; gid: number }, group: string, passwd: string): boolean {
  if (gid !== user.gid) return false;
  const rows = (text: string) => text.split("\n").map((line) => line.split(":"));
  const id = (field = "") => (/^\d+$/.test(field) ? Number(field) : -1);
  const entries = rows(group).filter((fields) => id(fields[2]) === gid);
  if (entries.length === 0) return false;
  for (const [name, , , members = ""] of entries) {
    if (name !== user.username) return false;
    if (members.split(",").some((member) => member && member !== user.username)) return false;
  }
  return !rows(passwd).some((fields) => id(fields[3]) === gid && fields[0] !== user.username);
}

export function specsDir(): string | null {
  if (process.env.FIGXIT_SPECS === "off") return null;
  const candidates = [
    process.env.FIGXIT_SPECS,
    join(dirname(executable()), "../Resources/specs"),
    join(import.meta.dir, "../node_modules/@withfig/autocomplete/build"),
  ];
  return candidates.find((path) => path && existsSync(join(path, "index.js"))) ?? null;
}

const DB_PATH = /^[ \t]*db_path[ \t]*=[ \t]*["']([^"'\n]+)["']/m;

function absolute(value: string | undefined): string | undefined {
  return value?.startsWith("/") ? value : undefined;
}

export function atuinPaths(env: Record<string, string | undefined> = process.env, home = homedir()): string[] {
  if (env.FIGXIT_ATUIN_DB) return [env.FIGXIT_ATUIN_DB];
  const atuinHome = absolute(env.ATUIN_HOME);
  const configs = [
    env.ATUIN_CONFIG_DIR && join(env.ATUIN_CONFIG_DIR, "config.toml"),
    atuinHome && join(atuinHome, "config.toml"),
    join(home, ".atuin/config.toml"),
    join(absolute(env.XDG_CONFIG_HOME) ?? join(home, ".config"), "atuin/config.toml"),
  ];
  const config = configs.find((path) => path && existsSync(path));
  let configured: string | undefined;
  try {
    configured = config ? DB_PATH.exec(readFileSync(config, "utf8"))?.[1] : undefined;
  } catch {}
  if (configured?.startsWith("~/")) configured = join(home, configured.slice(2));
  const paths = [
    configured,
    atuinHome && join(atuinHome, "data/history.db"),
    join(home, ".atuin/data/history.db"),
    join(absolute(env.XDG_DATA_HOME) ?? join(home, ".local/share"), "atuin/history.db"),
  ];
  return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}

export function atuinDb(env: Record<string, string | undefined> = process.env, home = homedir()): string | null {
  return atuinPaths(env, home).find((path) => existsSync(path)) ?? null;
}

export function resolveCommand(command: string): string {
  if (command.includes("/")) return command;
  return Bun.which(command, { PATH: process.env.PATH ?? "" }) ?? command;
}
