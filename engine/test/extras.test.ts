import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const root = join(import.meta.dir, "..");
const work = mkdtempSync(join(tmpdir(), "figxit-extras-"));
const installed = join(work, "installed");
let result: Record<string, any> = {};

function hashOf(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
}

beforeAll(async () => {
  const source = join(work, "source");
  mkdirSync(join(source, "aws"), { recursive: true });
  writeFileSync(join(source, "aws.js"), 'export default { name: "aws", subcommands: [{ name: "s3", loadSpec: "aws/s3" }] };\n');
  writeFileSync(join(source, "aws/s3.js"), 'export default { name: "s3", subcommands: [{ name: "from-download" }] };\n');
  const archive = join(work, "aws-test.tar.gz");
  Bun.spawnSync(["/usr/bin/tar", "-czf", archive, "-C", source, "aws.js", "aws"]);
  writeFileSync(join(work, "gcloud-test.tar.gz"), readFileSync(archive));
  mkdirSync(join(source, "az"), { recursive: true });
  writeFileSync(join(source, "az/index.js"), 'export default async (version) => ({ versionedSpecPath: "az/1.0.0", version });\n');
  writeFileSync(join(source, "az/1.0.0.js"), 'export default { name: "az", subcommands: [{ name: "from-versioned" }] };\nexport const versions = {};\n');
  const versioned = join(work, "az-test.tar.gz");
  Bun.spawnSync(["/usr/bin/tar", "-czf", versioned, "-C", source, "az"]);
  const entry = (file: string, sha256: string) => ({ file, sha256, bytes: 1, size: 1 });
  writeFileSync(
    join(work, "extras.json"),
    JSON.stringify({
      aws: entry("aws-test.tar.gz", hashOf(archive)),
      az: entry("az-test.tar.gz", hashOf(versioned)),
      gcloud: entry("gcloud-test.tar.gz", "0".repeat(64)),
    }),
  );

  const server = Bun.serve({ port: 0, fetch: (request) => new Response(Bun.file(join(work, basename(new URL(request.url).pathname)))) });
  writeFileSync(
    join(work, "run.ts"),
    `
import { existsSync } from "node:fs";
import { addExtra, downloadable, extras } from "${root}/src/extras";
import { History } from "${root}/src/history";
import { suggest } from "${root}/src/suggest";
const labels = async (line: string) => {
  const result = await suggest(line, line.length, "/", new History("/nonexistent"), 0);
  const found = result.now ?? (await result.more);
  return found?.items.map((item) => item.label) ?? [];
};
const offered = [downloadable("aws ", 4)?.name ?? null, downloadable("aws s", 5)?.name ?? null, downloadable("git ", 4)?.name ?? null];
const before = await labels("aws s3 ");
const mismatch = await addExtra("gcloud");
const added = await addExtra("aws");
const after = await labels("aws s3 ");
const offeredAfter = downloadable("aws ", 4)?.name ?? null;
const azAdded = await addExtra("az");
const az = await labels("az ");
console.log(JSON.stringify({
  before,
  mismatch,
  gcloudOnDisk: existsSync("${installed}/gcloud"),
  added,
  after,
  offered,
  offeredAfter,
  azAdded,
  az,
  states: extras().map((extra) => extra.name + ":" + extra.state),
}));
`,
  );
  const run = Bun.spawn(["bun", join(work, "run.ts")], {
    env: {
      ...process.env,
      FIGXIT_SPECS: "off",
      FIGXIT_EXTRAS_DIR: installed,
      FIGXIT_EXTRAS_MANIFEST: join(work, "extras.json"),
      FIGXIT_EXTRAS_URL: `http://localhost:${server.port}/`,
    },
    stdout: "pipe",
  });
  const output = await new Response(run.stdout).text();
  await run.exited;
  server.stop(true);
  result = JSON.parse(output);
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("extra completions", () => {
  test("a download with the wrong checksum is refused and installs nothing", () => {
    expect(result.mismatch).toContain("checksum");
    expect(result.gcloudOnDisk).toBe(false);
  });

  test("a downloaded extra loads in the running engine after an earlier miss", () => {
    expect(result.before).toEqual([]);
    expect(result.added).toBeNull();
    expect(result.after).toEqual(["from-download"]);
  });

  test("a downloaded versioned extra loads, like az", () => {
    expect(result.azAdded).toBeNull();
    expect(result.az).toEqual(["from-versioned"]);
  });

  test("offers a download only on the bare command, and only until it is installed", () => {
    expect(result.offered).toEqual(["aws", null, null]);
    expect(result.offeredAfter).toBeNull();
  });

  test("lists each extra as installed or missing", () => {
    expect(result.states).toEqual(["aws:installed", "az:installed", "gcloud:missing"]);
  });
});
