import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "../src/sources";
import { history, now, project, root, work } from "./fixture";

const { suggest } = await import("../src/suggest");

const VISIBLE = 8;
const scripts: string[][] = [
  [..."mak", "Tab", "Down", "Down"],
  [..."npm r", "Tab", "Down", "Down"],
  [..."g", "Tab", ..."ch", "Tab", "Down"],
  [..."d", "Tab", ..."r", "Tab", ..."--"],
  [..."p", "Down", "Down"],
];

const tabs = [];
const icons: Record<string, string> = {};
for (const keys of scripts) {
  let buffer = "";
  let items: Candidate[] = [];
  let selected = 0;
  let scroll = 0;
  let remove = 0;
  let col = 0;
  let navigated = false;
  const chosen = () => {
    const item = items[selected];
    return item !== undefined && Boolean(item.run || item.likely || (item.pick && remove > 0) || navigated);
  };
  const edit = async () => {
    const result = await suggest(buffer, buffer.length, project, history, now);
    const full = (result.more ? await result.more : null) ?? result.now;
    items = full?.items ?? [];
    remove = full?.remove ?? 0;
    col = buffer.length - remove + (full?.lead ?? 0);
    selected = 0;
    scroll = 0;
    navigated = false;
  };
  const steps = [];
  for (const key of keys) {
    if (key === "Down") {
      if (items.length === 0) continue;
      selected = (selected + (chosen() ? 1 : 0)) % items.length;
      navigated = true;
    } else if (key === "Tab") {
      const item = items[selected];
      if (!item) continue;
      buffer = item.run ? `${buffer} ` : buffer.slice(0, buffer.length - remove) + (item.insert ?? `${item.label} `);
      await edit();
    } else {
      buffer += key;
      await edit();
    }
    if (selected < scroll) scroll = selected;
    if (selected >= scroll + VISIBLE) scroll = selected - VISIBLE + 1;
    const shown = items.slice(scroll, scroll + VISIBLE).map(({ label, detail, icon, tint }) => ({ label, detail, icon, tint }));
    for (const { icon } of shown) {
      if (!icon?.startsWith("brand:") || icons[icon]) continue;
      const svg = readFileSync(join(root, "helper/Resources/icons", `${icon.slice(6)}.svg`), "utf8");
      icons[icon] = [...svg.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]).join(" ");
    }
    steps.push({ key, buffer, col, selected: chosen() ? selected - scroll : -1, items: shown });
  }
  tabs.push(steps);
}

writeFileSync(join(root, "internal/docs/demo.json"), JSON.stringify({ icons, tabs }));
for (const steps of tabs) {
  console.log(steps.at(-1)?.buffer);
  for (const step of steps) console.log(`  ${step.key.padEnd(4)} ${JSON.stringify(step.buffer).padEnd(22)} col ${step.col} sel ${step.selected}  ${step.items.map((item) => item.label).join(", ")}`);
}
rmSync(work, { recursive: true, force: true });
process.exit(0);
