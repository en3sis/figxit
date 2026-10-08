import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const out = join(root, "internal/docs/img");
const helper = join(root, "dist/Figxit.app/Contents/MacOS/figxit-helper");
const work = mkdtempSync(join(tmpdir(), "figxit-shots-"));
const project = join(work, "shop");
process.env.FIGXIT_ATUIN_DB = join(work, "none.db");

const { History } = await import("../src/history");
const { suggest } = await import("../src/suggest");
const { registerSpec } = await import("../src/specs");

mkdirSync(project);
mkdirSync(join(out, "scene"), { recursive: true });
writeFileSync(
  join(project, "Makefile"),
  [
    "##@ Development",
    "dev: ## Start the stack with hot reload",
    "dev-down: ## Stop the stack",
    "lint: ## Run the linters",
    "##@ Tests",
    "test: ## Run the unit tests",
    "test-e2e: ## Run the end-to-end tests",
    "##@ Release",
    "build: ## Build the production image",
    "deploy: ## Deploy to production",
    "",
  ].join("\n"),
);
writeFileSync(
  join(project, "package.json"),
  JSON.stringify({
    scripts: {
      dev: "next dev --turbopack",
      build: "next build",
      start: "next start",
      lint: "eslint . --fix",
      "test:unit": "vitest run",
      "test:e2e": "playwright test",
      "db:migrate": "prisma migrate dev",
    },
  }),
);

const ops = join(work, "ops");
mkdirSync(ops);
writeFileSync(
  join(ops, "Makefile"),
  [
    "##@ Develop",
    "dev: ## Start the stack",
    "test: ## Run the tests",
    "##@ Deploy",
    "deploy-staging: ## Deploy to staging",
    "deploy-prod: ## Deploy to production",
    "release: ## [prod] Publish the app",
    "db-reset: ## [danger] Drop the data and seed again",
    "",
  ].join("\n"),
);
registerSpec("ssh", {
  name: "ssh",
  args: {
    name: "host",
    generators: [
      {
        custom: async () =>
          ["PROD", "PROD-DB", "staging", "kara", "backup"].map((name) => ({ name, description: "SSH host", priority: 50 })),
      },
    ],
  },
});

const history = new History();
const now = Date.now();
const used: [string, number][] = [
  ["make dev", 9],
  ["make test", 4],
  ["make deploy", 2],
  ["npm run dev", 8],
  ["npm run test:unit", 3],
  ["python3 main.py", 7],
  ["pnpm install", 6],
  ["psql app", 5],
  ["podman ps", 4],
  ["php artisan", 3],
  ["prettier .", 3],
  ["pulumi up", 2],
  ["poetry install", 2],
  ["git checkout main", 9],
  ["git cherry-pick abc", 2],
  ["docker run --rm -it app", 6],
  ["docker run --name web app", 3],
];
for (const [command, times] of used) {
  for (let i = 0; i < times; i++) history.add(command, project, now - i * 3_600_000, 0);
}

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
