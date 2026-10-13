import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { history, now, ops, project, root, work } from "./fixture";

const { suggest } = await import("../src/suggest");

const out = join(root, "internal/docs/img");
const helper = join(root, "dist/Figxit.app/Contents/MacOS/figxit-helper");
mkdirSync(join(out, "scene"), { recursive: true });

const shots: [string, string, number, string?][] = [
  ["caution-make", "make ", 6, ops],
  ["caution-hosts", "ssh ", 5, ops],
  ["make", "make ", 7],
  ["scripts", "npm run ", 7],
  ["commands", "p", 8],
  ["git", "git ch", 5],
  ["options", "docker run --", 8],
];

for (const [name, buffer, count, cwd] of shots) {
  const result = await suggest(buffer, buffer.length, cwd ?? project, history, now);
  const full = result.more ? await result.more : result.now;
  const items = (full?.items ?? []).slice(0, count).map(({ label, detail, icon, tint }) => ({ label, detail, icon, tint }));
  const file = join(work, `${name}.json`);
  writeFileSync(file, JSON.stringify(items));
  for (const mode of ["light", "dark"]) {
    const png = join(out, mode === "dark" ? `${name}-dark.png` : `${name}.png`);
    const run = Bun.spawnSync([helper, "snapshot", file, png, mode]);
    console.log(`${run.exitCode === 0 ? "ok  " : "FAIL"} ${name} ${mode} (${items.length} rows)`);
    const scene = join(out, "scene", mode === "dark" ? `${name}-dark.png` : `${name}.png`);
    const framed = Bun.spawnSync([helper, "snapshot-scene", file, scene, buffer, cwd ? "~/ops" : "~/shop", mode]);
    if (framed.exitCode !== 0) console.log(`FAIL scene ${name} ${mode}`);
  }
}
rmSync(work, { recursive: true, force: true });
process.exit(0);
