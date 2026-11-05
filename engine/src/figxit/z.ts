import { homedir } from "node:os";
import { ICONS } from "../brands";
import { escapePath } from "../generators";
import type { Spec } from "../specs";

const MAX_ROWS = 40;

type Run = (input: unknown) => Promise<{ stdout: string; status: number }>;

function tilde(path: string, home: string): string {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export async function zoxideFolders(tokens: string[], run: Run, context: { currentWorkingDirectory: string }): Promise<Spec[]> {
  const terms = tokens.slice(1).filter((term) => term !== "");
  const { stdout, status } = await run({
    command: "zoxide",
    args: ["query", "--list", "--exclude", context.currentWorkingDirectory, "--", ...terms],
  });
  if (status !== 0) return [];
  const home = homedir();
  return stdout
    .split("\n")
    .filter((path) => path.startsWith("/"))
    .slice(0, MAX_ROWS)
    .map((path, index) => {
      const label = tilde(path, home);
      return {
        name: label,
        description: index === 0 ? "Best match" : "folder",
        priority: 100 - index,
        insertValue: `${escapePath(label)} `,
        icon: ICONS.visited.icon,
      };
    });
}

const folders: Spec = {
  name: "folder",
  isVariadic: true,
  template: "folders",
  generators: { custom: zoxideFolders, trigger: { on: "change" }, filtered: true },
};

export const z: Spec = { name: "z", description: "Go to a folder ranked by zoxide", args: folders };

export const zi: Spec = { name: "zi", description: "Pick a folder ranked by zoxide", args: folders };
