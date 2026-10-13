import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const root = join(import.meta.dir, "../..");
export const work = mkdtempSync(join(tmpdir(), "figxit-shots-"));
export const project = join(work, "shop");
process.env.FIGXIT_ATUIN_DB = join(work, "none.db");

const { History } = await import("../src/history");
const { registerSpec } = await import("../src/specs");

mkdirSync(project);
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

const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=shop", "-c", "user.email=shop@example.com", ...args], { cwd: project });
git("init", "-q", "-b", "main");
git("add", ".");
git("commit", "-q", "-m", "Shop");
for (const branch of ["develop", "feature/checkout", "feature/search", "fix/cart-total"]) git("branch", branch);

const bin = join(work, "bin");
mkdirSync(bin);
writeFileSync(
  join(bin, "docker"),
  [
    "#!/bin/sh",
    '[ "$1" = images ] || exit 0',
    "cat <<'EOF'",
    "shop-web 412MB latest 9f2c1a7b3d10",
    "shop-api 884MB latest b5c5f037df59",
    "postgres 438MB 17 e001eb89ef14",
    "redis 41.4MB 7-alpine 51f42ab11ad5",
    "nginx 192MB 1.27 8b20b62e1c76",
    "node 1.12GB 22 d7fd863529de",
    "EOF",
    "",
  ].join("\n"),
);
chmodSync(join(bin, "docker"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

export const ops = join(work, "ops");
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

export const history = new History();
export const now = Date.now();
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
