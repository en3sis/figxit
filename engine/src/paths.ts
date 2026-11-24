import { existsSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

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

export function trusted(stat: Stats): boolean {
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid && stat.uid !== 0) return false;
  if (stat.mode & 0o002) return false;
  return (stat.mode & 0o020) === 0 || ownGroup(stat.gid);
}

export function trustedFolders(file: string, home = homedir()): boolean {
  try {
    const written = dirname(resolve(file));
    const real = dirname(realpathSync(file));
    return foldersUpTo(written, resolve(home)) && (real === written || foldersUpTo(real, realpathSync(home)));
  } catch {
    return false;
  }
}

function foldersUpTo(folder: string, home: string): boolean {
  for (let path = folder; path !== home; path = dirname(path)) {
    const stat = statSync(path);
    if (!trusted(stat) && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0)) return false;
    if (path === dirname(path)) break;
  }
  return true;
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
