import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as icons from "simple-icons";

const COMMANDS: Record<string, string[]> = {
  git: ["git"],
  github: ["gh", "hub"],
  gitlab: ["glab"],
  docker: ["docker", "docker-compose"],
  podman: ["podman"],
  npm: ["npm", "npx"],
  pnpm: ["pnpm", "pnpx"],
  yarn: ["yarn"],
  bun: ["bun", "bunx"],
  nodedotjs: ["node", "nvm", "fnm"],
  deno: ["deno"],
  typescript: ["tsc", "tsx", "ts-node"],
  python: ["python", "python3", "pip", "pip3", "pipx"],
  uv: ["uv", "uvx"],
  poetry: ["poetry"],
  anaconda: ["conda"],
  jupyter: ["jupyter"],
  rust: ["cargo", "rustc", "rustup"],
  go: ["go"],
  swift: ["swift", "swiftc"],
  xcode: ["xcodebuild", "xcrun", "xcode-select"],
  ruby: ["ruby", "gem", "bundle", "irb"],
  rubyonrails: ["rails"],
  cocoapods: ["pod"],
  fastlane: ["fastlane"],
  php: ["php"],
  composer: ["composer"],
  elixir: ["elixir", "mix", "iex"],
  gleam: ["gleam"],
  zig: ["zig"],
  lua: ["lua"],
  dotnet: ["dotnet"],
  gradle: ["gradle", "gradlew"],
  apachemaven: ["mvn"],
  openjdk: ["java", "javac"],
  kotlin: ["kotlin", "kotlinc"],
  flutter: ["flutter"],
  dart: ["dart"],
  cmake: ["cmake"],
  ninja: ["ninja"],
  bazel: ["bazel"],
  just: ["just"],
  terraform: ["terraform"],
  opentofu: ["tofu"],
  pulumi: ["pulumi"],
  ansible: ["ansible", "ansible-playbook"],
  vagrant: ["vagrant"],
  packer: ["packer"],
  vault: ["vault"],
  kubernetes: ["kubectl", "kubectx", "kubens"],
  helm: ["helm"],
  k9s: ["k9s"],
  minikube: ["minikube"],
  argo: ["argocd"],
  tmux: ["tmux"],
  neovim: ["nvim"],
  vim: ["vim", "vi"],
  zedindustries: ["zed"],
  homebrew: ["brew"],
  nixos: ["nix", "nix-shell"],
  ollama: ["ollama"],
  huggingface: ["hf", "huggingface-cli"],
  claude: ["claude"],
  postgresql: ["psql", "pg_dump", "pg_restore", "createdb"],
  mysql: ["mysql", "mysqldump"],
  sqlite: ["sqlite3"],
  redis: ["redis-cli", "redis-server"],
  mongodb: ["mongosh", "mongod"],
  duckdb: ["duckdb"],
  curl: ["curl"],
  wget: ["wget"],
  nginx: ["nginx"],
  ffmpeg: ["ffmpeg", "ffprobe"],
  supabase: ["supabase"],
  vercel: ["vercel"],
  netlify: ["netlify"],
  stripe: ["stripe"],
  expo: ["expo", "eas"],
  cloudflare: ["wrangler", "cloudflared"],
  tailscale: ["tailscale"],
  "1password": ["op"],
  googlecloud: ["gcloud", "gsutil"],
  firebase: ["firebase"],
  heroku: ["heroku"],
  flydotio: ["fly", "flyctl"],
  railway: ["railway"],
  sentry: ["sentry-cli"],
  vite: ["vite"],
  vitest: ["vitest"],
  jest: ["jest"],
  eslint: ["eslint"],
  prettier: ["prettier"],
  turborepo: ["turbo"],
  nx: ["nx"],
  pm2: ["pm2"],
  starship: ["starship"],
  zsh: ["zsh"],
  gnubash: ["bash", "sh"],
  fishshell: ["fish"],
  ghostty: ["ghostty"],
  hugo: ["hugo"],
  infisical: ["infisical"],
  orbstack: ["orb", "orbctl"],
  lmstudio: ["lms"],
  atuin: ["atuin"],
  mise: ["mise"],
  android: ["adb", "emulator", "sdkmanager"],
  apple: ["open", "defaults", "codesign", "osascript", "pbcopy", "pbpaste"],
};

const LINKS = ["github", "discord"];

const root = join(import.meta.dir, "../..");
const out = join(root, "helper/Resources/icons");
const bySlug = new Map(Object.values(icons).map((icon) => [icon.slug, icon]));
const brands: Record<string, { slug: string; hex: string }> = {};
const missing: string[] = [];

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;

function spacedArcs(path: string): string {
  if (!/[aA]/.test(path)) return path;
  const parts: string[] = [];
  let command = "";
  let index = 0;
  let at = 0;
  while (at < path.length) {
    const char = path[at]!;
    if (/[a-zA-Z]/.test(char)) {
      parts.push(char);
      command = char;
      index = 0;
      at++;
    } else if (/[\s,]/.test(char)) {
      at++;
    } else if ((command === "a" || command === "A") && (index % 7 === 3 || index % 7 === 4)) {
      parts.push(char);
      index++;
      at++;
    } else {
      const match = NUMBER.exec(path.slice(at));
      if (!match) return path;
      parts.push(match[0]);
      index++;
      at += match[0].length;
    }
  }
  return parts.join(" ");
}

function svgOf(icon: { svg: string }): string {
  return icon.svg.replace(/ d="([^"]*)"/g, (_, path: string) => ` d="${spacedArcs(path)}"`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const [slug, commands] of Object.entries(COMMANDS)) {
  const icon = bySlug.get(slug);
  if (!icon) {
    missing.push(slug);
    continue;
  }
  writeFileSync(join(out, `${slug}.svg`), svgOf(icon));
  for (const command of commands) brands[command] = { slug, hex: icon.hex };
}

for (const slug of LINKS) {
  const icon = bySlug.get(slug);
  if (icon) writeFileSync(join(out, `${slug}.svg`), svgOf(icon));
  else missing.push(slug);
}

const sorted = Object.fromEntries(Object.entries(brands).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(join(root, "engine/src/brands.json"), JSON.stringify(sorted, null, 2) + "\n");
console.log(`${Object.keys(COMMANDS).length - missing.length} icons, ${Object.keys(brands).length} commands`);
if (missing.length) console.log(`not in simple-icons: ${missing.join(", ")}`);
