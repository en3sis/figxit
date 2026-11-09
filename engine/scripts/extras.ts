import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EXTRAS, type Extra } from "../src/extras";

const [manifestPath, outDir] = process.argv.slice(2).map((path) => resolve(path));
if (!manifestPath || !outDir) {
  console.error("Usage: bun run scripts/extras.ts <manifest.json> <archive folder>");
  process.exit(1);
}

const specs = join(import.meta.dir, "../node_modules/@withfig/autocomplete/build");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const manifest: Record<string, Extra> = {};
for (const name of Object.keys(EXTRAS)) {
  const top = existsSync(join(specs, `${name}.js`)) ? [`${name}.js`] : [];
  const files = [...top, ...[...new Bun.Glob("**/*.js").scanSync({ cwd: join(specs, name) })].map((file) => join(name, file))].sort();
  const tar = Bun.spawnSync(
    ["/usr/bin/tar", "--no-xattrs", "--no-mac-metadata", "--uid", "0", "--gid", "0", "--uname", "", "--gname", "", "-cf", "-", "-C", specs, ...files],
    { env: { ...process.env, COPYFILE_DISABLE: "1" }, stdout: "pipe", stderr: "pipe" },
  );
  if (tar.exitCode !== 0) {
    console.error(`tar failed for ${name}: ${tar.stderr.toString()}`);
    process.exit(1);
  }
  const archive = Bun.gzipSync(tar.stdout, { level: 9 });
  const sha256 = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
  const file = `${name}-${sha256.slice(0, 16)}.tar.gz`;
  writeFileSync(join(outDir, file), archive);
  const size = files.reduce((total, path) => total + statSync(join(specs, path)).size, 0);
  manifest[name] = { file, sha256, bytes: archive.length, size };
  console.log(`${file}  ${(archive.length / 1e6).toFixed(1)} MB, ${(size / 1e6).toFixed(1)} MB unpacked`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
