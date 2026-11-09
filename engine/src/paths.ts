import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE = join(homedir(), ".local/state/figxit");

export const ENGINE_SOCK = process.env.FIGXIT_SOCK ?? join(STATE, "engine.sock");
export const HELPER_SOCK = process.env.FIGXIT_HELPER_SOCK ?? join(STATE, "helper.sock");

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

export function userSpecsDir(): string {
  return process.env.FIGXIT_USER_SPECS ?? join(homedir(), ".figxit/specs");
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
    env.FIGXIT_ATUIN_DB,
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
