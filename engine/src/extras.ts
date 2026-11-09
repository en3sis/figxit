import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { executable } from "./paths";

export const EXTRAS: Record<string, string> = {
  aws: "AWS CLI",
  gcloud: "Google Cloud CLI",
};

const SOURCE = "https://figxit.com/download/specs/";
const TIMEOUT_MS = 120_000;
const HASH = /^[0-9a-f]{64}$/;
const FILE = /^[\w.-]+\.tar\.gz$/;

export interface Extra {
  file: string;
  sha256: string;
  bytes: number;
  size: number;
}

export interface ExtraState extends Extra {
  name: string;
  title: string;
  state: "installed" | "outdated" | "missing";
}

export function extrasDir(): string {
  return process.env.FIGXIT_EXTRAS_DIR ?? join(homedir(), "Library/Application Support/Figxit/specs");
}

export function extraRoot(name: string): string | null {
  const root = name.split("/")[0]!;
  return Object.hasOwn(EXTRAS, root) ? root : null;
}

function valid(entry: any): entry is Extra {
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.file === "string" &&
    FILE.test(entry.file) &&
    typeof entry.sha256 === "string" &&
    HASH.test(entry.sha256) &&
    Number.isFinite(entry.bytes) &&
    Number.isFinite(entry.size)
  );
}

export function manifest(): Record<string, Extra> {
  const path = process.env.FIGXIT_EXTRAS_MANIFEST ?? join(dirname(executable()), "../Resources/extras.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Object.fromEntries(Object.entries(parsed).filter(([name, entry]) => Object.hasOwn(EXTRAS, name) && valid(entry))) as Record<string, Extra>;
  } catch {
    return {};
  }
}

function installedHash(name: string): string | null {
  try {
    return readFileSync(join(extrasDir(), name, "sha256"), "utf8").trim();
  } catch {
    return null;
  }
}

export function extraInstalled(name: string): boolean {
  return Object.hasOwn(EXTRAS, name) && installedHash(name) !== null;
}

export function extraSource(name: string): { file?: string; versioned?: string } | null {
  const root = extraRoot(name);
  if (!root || !extraInstalled(root)) return null;
  const base = join(extrasDir(), root);
  const file = join(base, `${name}.js`);
  if (existsSync(file)) return { file };
  return name === root && existsSync(join(base, name, "index.js")) ? { versioned: base } : null;
}

export function extras(): ExtraState[] {
  return Object.entries(manifest()).map(([name, entry]) => {
    const hash = installedHash(name);
    return { name, title: EXTRAS[name]!, ...entry, state: hash === null ? "missing" : hash === entry.sha256 ? "installed" : "outdated" };
  });
}

export async function addExtra(name: string): Promise<string | null> {
  const entry = manifest()[name];
  if (!entry) return `${name} is not an extra in this version of Figxit`;
  let data: Uint8Array;
  try {
    const response = await fetch((process.env.FIGXIT_EXTRAS_URL ?? SOURCE) + entry.file, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return `download failed: HTTP ${response.status}`;
    data = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return `download failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  const hash = new Bun.CryptoHasher("sha256").update(data).digest("hex");
  if (hash !== entry.sha256) return "download failed: the file does not match the expected checksum";

  const dir = extrasDir();
  let work: string;
  try {
    mkdirSync(dir, { recursive: true });
    work = mkdtempSync(join(dir, `.${name}-`));
  } catch (error) {
    return `could not write to ${dir}: ${error instanceof Error ? error.message : String(error)}`;
  }
  try {
    const unpacked = join(work, name);
    mkdirSync(unpacked);
    writeFileSync(join(work, "archive.tar.gz"), data);
    const tar = Bun.spawnSync(["/usr/bin/tar", "-xzf", join(work, "archive.tar.gz"), "-C", unpacked], { stderr: "pipe" });
    if (tar.exitCode !== 0 || !existsSync(join(unpacked, `${name}.js`))) return "the archive could not be unpacked";
    writeFileSync(join(unpacked, "sha256"), `${hash}\n`);
    const target = join(dir, name);
    if (existsSync(target)) renameSync(target, join(work, "previous"));
    renameSync(unpacked, target);
    return null;
  } catch (error) {
    return `could not install ${name}: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function removeExtra(name: string): string | null {
  if (!Object.hasOwn(EXTRAS, name)) return `${name} is not an extra`;
  rmSync(join(extrasDir(), name), { recursive: true, force: true });
  return null;
}

export async function updateExtras(): Promise<void> {
  for (const extra of extras()) {
    if (extra.state === "outdated") await addExtra(extra.name).catch(() => null);
  }
}
