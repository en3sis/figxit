import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE = join(homedir(), ".local/state/figxit");

export const ENGINE_SOCK = process.env.FIGXIT_SOCK ?? join(STATE, "engine.sock");
export const HELPER_SOCK = process.env.FIGXIT_HELPER_SOCK ?? join(STATE, "helper.sock");

function executable(): string {
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

export function specsDir(): string | null {
  if (process.env.FIGXIT_SPECS === "off") return null;
  const candidates = [
    process.env.FIGXIT_SPECS,
    join(dirname(executable()), "../Resources/specs"),
    join(import.meta.dir, "../node_modules/@withfig/autocomplete/build"),
  ];
  return candidates.find((path) => path && existsSync(join(path, "index.js"))) ?? null;
}

export function resolveCommand(command: string): string {
  if (command.includes("/")) return command;
  return Bun.which(command, { PATH: process.env.PATH ?? "" }) ?? command;
}
