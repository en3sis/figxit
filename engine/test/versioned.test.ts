import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyVersions } from "../src/versioned";

const root = join(import.meta.dir, "..");
const work = mkdtempSync(join(tmpdir(), "figxit-versioned-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  writeFileSync(join(work, "heroku"), '#!/bin/sh\necho "heroku/8.0.0 darwin-arm64"\n');
  chmodSync(join(work, "heroku"), 0o755);
  writeFileSync(
    join(work, "run.ts"),
    `
import { History } from "${root}/src/history";
import { loadSpec } from "${root}/src/specs";
import { suggest } from "${root}/src/suggest";
const found = await suggest("az ", 3, "/", new History("/nonexistent"), 0);
const az = ((found.now ?? (await found.more))?.items ?? []).map((item) => item.label);
const first = (await loadSpec("heroku"))?.subcommands.length;
let later = first;
for (let i = 0; i < 60 && later === first; i++) {
  await Bun.sleep(50);
  later = (await loadSpec("heroku"))?.subcommands.length;
}
console.log(JSON.stringify({ az, first, later }));
`,
  );
  const run = Bun.spawn(["bun", join(work, "run.ts")], {
    env: { ...process.env, PATH: `${work}:${process.env.PATH}` },
    stdout: "pipe",
  });
  result = JSON.parse(await new Response(run.stdout).text());
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("versioned specs", () => {
  const base = {
    name: "tool",
    subcommands: [{ name: "build", options: [{ name: "--fast" }] }, { name: "legacy" }],
  };
  const versions = {
    "1.1.0": { subcommands: [{ name: "legacy", remove: true }, { name: "deploy" }] },
    "2.0.0": { subcommands: [{ name: "build", options: [{ name: "--watch" }] }] },
  };
  const names = (spec: any) => spec.subcommands.map((command: any) => command.name).sort();
  const options = (spec: any) => spec.subcommands.find((command: any) => command.name === "build").options.map((option: any) => option.name).sort();

  test("applies the diffs up to the installed version", () => {
    const spec = applyVersions(base, versions, "1.5.0");
    expect(names(spec)).toEqual(["build", "deploy"]);
    expect(options(spec)).toEqual(["--fast"]);
  });

  test("applies every diff when the version is unknown, without changing the base spec", () => {
    const spec = applyVersions(base, versions, undefined);
    expect(options(spec)).toEqual(["--fast", "--watch"]);
    expect(names(base)).toEqual(["build", "legacy"]);
  });

  test("az completes from its versioned spec", () => {
    expect(result.az).toContain("account");
  });

  test("switches to the spec for the installed version once it is known", () => {
    expect(result.first).toBe(299);
    expect(result.later).toBe(342);
  });
});
