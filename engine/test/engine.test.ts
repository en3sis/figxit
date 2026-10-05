process.env.FIGXIT_SPECS = "off";

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTmux } from "../src/geometry";
import { History } from "../src/history";
import { parseMakefile, parseScripts } from "../src/sources";
import { matchScore, secretLike, suggest as suggestAsync } from "../src/suggest";
import { registerSpec } from "../src/specs";
import { commandWords, historySegments, scan } from "../src/tokenize";
import { verbIcon, verbOf } from "../src/verbs";
import { classify } from "../../worker/stats";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "figxit-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

async function suggest(buffer: string, cursor: number, cwd: string, history: History, now: number) {
  const result = await suggestAsync(buffer, cursor, cwd, history, now);
  return result.more ? await result.more : result.now;
}

function historyOf(rows: [string, string, number?, number?][]): History {
  const history = new History("/nonexistent");
  for (const [command, cwd, ageDays = 1, exit = 0] of rows) history.add(command, cwd, NOW - ageDays * DAY, exit);
  return history;
}

describe("scan", () => {
  test("splits words and tracks the open token", async () => {
    const result = scan("git checkout ma");
    expect(result.segments).toEqual([["git", "checkout"]]);
    expect(result.prefix).toBe("ma");
    expect(result.tokenStart).toBe(13);
  });

  test("a trailing space starts an empty token at the end", () => {
    const result = scan("make ");
    expect(result.segments).toEqual([["make"]]);
    expect(result.prefix).toBe("");
    expect(result.tokenStart).toBe(5);
  });

  test("separators start a new segment", () => {
    expect(scan("cd app && make de").segments.at(-1)).toEqual(["make"]);
    expect(scan("echo $(git sw").segments.at(-1)).toEqual(["git"]);
  });

  test("quotes keep spaces and report an open quote", () => {
    expect(scan('git commit -m "a b" ').segments).toEqual([["git", "commit", "-m", "a b"]]);
    expect(scan('git commit -m "a b').quoted).toBe(true);
  });

  test("commandWords drops assignments and wrappers", () => {
    expect(commandWords(["FOO=1", "sudo", "make", "dev"])).toEqual(["make", "dev"]);
  });

  test("historySegments keeps the last word of each segment", () => {
    expect(historySegments("cd app && make dev")).toEqual([["cd", "app"], ["make", "dev"]]);
  });
});

describe("matchScore", () => {
  test("ranks prefix over substring over subsequence", () => {
    expect(matchScore("deploy", "de")).toBe(1);
    expect(matchScore("redeploy", "de")).toBe(0.45);
    expect(matchScore("dev-seed", "dsd")).toBe(0.2);
    expect(matchScore("build", "x")).toBe(0);
  });
});

describe("sources", () => {
  test("parseMakefile reads targets and help text", () => {
    const targets = parseMakefile("VAR := 1\n.PHONY: dev\ndev: deps ## Start the stack\n\techo hi\nbuild:\n%.o: %.c\n");
    expect(targets.map((t) => t.label)).toEqual(["dev", "build"]);
    expect(targets[0]!.detail).toBe("Start the stack");
    expect(targets[1]!.detail).toBe("make target");
  });

  test("parseMakefile adds the ##@ section to the detail", () => {
    const targets = parseMakefile("##@ Build\nbuild: ## Build the project\ninstall:\n##@ Tests\ntest-e2e: deps ## Run the e2e tests\n");
    expect(targets.map((t) => t.detail)).toEqual(["Build · Build the project", "Build", "Tests · Run the e2e tests"]);
  });

  test("the verb in a name sets the icon, with one tile colour", () => {
    expect(["dev", "start", "serve", "dev-infra", "docker-up"].map(verbOf)).toEqual(["run", "run", "run", "run", "run"]);
    expect(["dev-down", "prod-down", "stop"].map(verbOf)).toEqual(["stop", "stop", "stop"]);
    expect(["test:e2e", "lint:fix", "db:migrate", "deploy-all", "prod-reset", "build:docs", "docs:build"].map(verbOf)).toEqual([
      "test",
      "check",
      "data",
      "release",
      "clean",
      "build",
      "docs",
    ]);
    expect(verbOf("prod")).toBeNull();
    expect(verbIcon("dev")).toEqual({ icon: "sf:play.fill", tint: "3A3A3C" });
    expect(verbIcon("prod")).toEqual({ icon: "sf:terminal.fill", tint: "3A3A3C" });
    expect(parseMakefile("dev:\n")[0]!.icon).toBe("sf:play.fill");
    expect(parseScripts('{"scripts":{"lint":"eslint"}}')[0]!.icon).toBe("sf:wand.and.stars");
  });

  test("parseScripts reads package.json scripts", () => {
    expect(parseScripts('{"scripts":{"dev":"vite","lint":"eslint ."}}').map((s) => s.label)).toEqual(["dev", "lint"]);
    expect(parseScripts("not json")).toEqual([]);
  });
});

describe("suggest", () => {
  test("make targets are ranked by history in this directory", async () => {
    const cwd = project({ Makefile: "admin-url:\nbuild:\ndeploy:\ndev:\n" });
    const history = historyOf([
      ["make dev", cwd, 1],
      ["make dev", cwd, 2],
      ["make build", cwd, 3],
      ["make deploy", "/elsewhere", 1],
      ["make ghost", cwd, 1],
    ]);
    const result = (await suggest("make ", 5, cwd, history, NOW))!;
    expect(result.items.map((i) => i.label)).toEqual(["dev", "build", "deploy", "admin-url"]);
    expect(result.remove).toBe(0);
  });

  test("the typed prefix filters and sets the removal length", async () => {
    const cwd = project({ Makefile: "build:\ndeploy:\ndev:\n" });
    const result = (await suggest("make de", 7, cwd, historyOf([]), NOW))!;
    expect(result.items.map((i) => i.label)).toEqual(["deploy", "dev"]);
    expect(result.remove).toBe(2);
    expect(result.tokenStart).toBe(5);
  });

  test("history supplies subcommands when no source knows the command", async () => {
    const history = historyOf([
      ["docker compose up -d", "/a", 1],
      ["docker compose up", "/b", 2],
      ["docker compose logs -f", "/a", 3],
      ["docker ps", "/a", 1],
    ]);
    const result = (await suggest("docker compose ", 15, "/c", history, NOW))!;
    expect(result.items.map((i) => i.label)).toEqual(["up", "logs"]);
  });

  test("flags appear only after a dash", async () => {
    const history = historyOf([
      ["ls -la", "/a"],
      ["ls src", "/a"],
    ]);
    expect((await suggest("ls ", 3, "/b", history, NOW))!.items.map((i) => i.label)).toEqual(["src"]);
    expect((await suggest("ls -", 4, "/b", history, NOW))!.items.map((i) => i.label)).toEqual(["-la"]);
  });

  test("paths from other directories are dropped", async () => {
    const history = historyOf([
      ["cat ./notes.md", "/a"],
      ["cat ./local.md", "/here"],
    ]);
    expect((await suggest("cat ", 4, "/here", history, NOW))!.items.map((i) => i.label)).toEqual(["./local.md"]);
  });

  test("command position needs a prefix and two uses", async () => {
    const history = historyOf([
      ["make dev", "/a"],
      ["make build", "/a"],
      ["mkae dev", "/a", 1, 127],
      ["mysql", "/a"],
      ["tmux a", "/a"],
      ["tmux ls", "/a"],
      ["rm x", "/a"],
      ["rm y", "/a"],
    ]);
    expect(await suggest("", 0, "/a", history, NOW)).toBeNull();
    expect((await suggest("m", 1, "/a", history, NOW))!.items.map((i) => i.label)).toEqual(["make"]);
  });

  test("no suggestions in an open quote or in the middle of a word", async () => {
    const history = historyOf([["git commit -m fix", "/a"]]);
    expect(await suggest('git commit -m "fi', 17, "/a", history, NOW)).toBeNull();
    expect(await suggest("git commit", 5, "/a", history, NOW)).toBeNull();
  });
});

describe("project targets", () => {
  test("make lists targets one time", async () => {
    const cwd = project({ Makefile: "build:\ndev:\n" });
    const first = (await suggest("make ", 5, cwd, historyOf([]), NOW))!;
    expect(first.items.map((i) => i.label)).toEqual(["build", "dev"]);
    expect(await suggest("make build ", 11, cwd, historyOf([]), NOW)).toBeNull();
    const flagged = (await suggest("make -j4 ", 9, cwd, historyOf([]), NOW))!;
    expect(flagged.items.map((i) => i.label)).toEqual(["build", "dev"]);
    const jobs = (await suggest("make -j 4 ", 10, cwd, historyOf([]), NOW))!;
    expect(jobs.items.map((i) => i.label)).toEqual(["build", "dev"]);
  });
});

describe("commands", () => {
  test("shell keywords are not commands, and the command after them counts", async () => {
    const cwd = project({});
    const loop = "for f in a b; do deploytool push; done";
    const history = historyOf([
      [loop, cwd, 1],
      [loop, cwd, 2],
      ["if deploytool check; then deploytool push; fi", cwd, 3],
      ["dig example.com", cwd, 4],
      ["dig example.com", cwd, 5],
    ]);
    const result = await suggest("d", 1, cwd, history, NOW);
    expect(result?.items.map((i) => i.label).sort()).toEqual(["deploytool", "dig"]);
    expect(result?.items.every((i) => i.pick)).toBe(true);
    const next = await suggest("deploytool ", 11, cwd, history, NOW);
    expect(next?.items.map((i) => i.label).sort()).toEqual(["check", "push"]);
  });

  test("a complete command gets a run row first, then the longer names", async () => {
    const cwd = project({});
    const history = historyOf([
      ["ls", cwd, 1],
      ["ls", cwd, 2],
      ["lsof -i", cwd, 3],
      ["lsof -i", cwd, 4],
    ]);
    const partial = await suggest("l", 1, cwd, history, NOW);
    expect(partial?.items.map((i) => i.label).sort()).toEqual(["ls", "lsof"]);
    const complete = await suggest("ls", 2, cwd, history, NOW);
    expect(complete?.items.map((i) => [i.label, i.run === true])).toEqual([["ls", true], ["lsof", false]]);
  });

  test("a complete command with subcommands shows them before the space", async () => {
    const cwd = project({ "notes.txt": "" });
    registerSpec("craft", {
      name: "craft",
      subcommands: [{ name: "build" }, { name: "serve" }],
      options: [{ name: "--verbose" }],
    });
    registerSpec("peek", { name: "peek", args: { name: "file", template: "filepaths" } });
    const result = await suggest("craft", 5, cwd, historyOf([]), NOW);
    expect(result?.items.map((i) => [i.label, i.run === true])).toEqual([["craft", true], ["build", false], ["serve", false]]);
    expect(result?.items[1]?.insert).toBe(" build ");
    expect(result?.remove).toBe(0);
    const files = await suggest("peek", 4, cwd, historyOf([]), NOW);
    expect(files?.items.map((i) => [i.label, i.run === true])).toEqual([["peek", true]]);
  });

  test("a complete subcommand gets a run row first, then the longer names", async () => {
    registerSpec("box", {
      name: "box",
      subcommands: [
        { name: "ps" },
        { name: "psql" },
        { name: "pause" },
        { name: ["compose", "cps"] },
        { name: "exec", args: { name: "container" } },
        { name: "prune", isDangerous: true },
      ],
    });
    const partial = await suggest("box p", 5, "/", historyOf([]), NOW);
    expect(partial?.items.map((i) => i.label).sort()).toEqual(["pause", "prune", "ps", "psql"]);
    expect(partial?.items.every((i) => i.pick && !i.run)).toBe(true);
    const complete = await suggest("box ps", 6, "/", historyOf([]), NOW);
    expect(complete?.items.map((i) => [i.label, i.run === true])).toEqual([["ps", true], ["psql", false]]);
    const alias = await suggest("box cps", 7, "/", historyOf([]), NOW);
    expect(alias?.items.map((i) => [i.label, i.run === true])).toEqual([["cps", true]]);
    expect(await suggest("box exec", 8, "/", historyOf([]), NOW)).toBeNull();
    expect(await suggest("box prune", 9, "/", historyOf([]), NOW)).toBeNull();
  });
});

describe("caution colour", () => {
  const red = (items: { label: string; tint?: string }[]) => items.filter((i) => i.tint === "D70015").map((i) => i.label).sort();

  test("a generated name in capitals or with prod gets the red tile", async () => {
    registerSpec("hop", {
      name: "hop",
      args: {
        name: "host",
        generators: [
          { custom: async () => ["PROD", "DB-EU_1", "api-prod", "kara", "A", "Mixed", "product"].map((name) => ({ name })) },
        ],
      },
    });
    const result = await suggest("hop ", 4, "/", historyOf([]), NOW);
    expect(red(result!.items)).toEqual(["DB-EU_1", "PROD", "api-prod"]);
  });

  test("make targets: capitals, prod in the name, or a tag in the help text", () => {
    const targets = parseMakefile(
      "dev: ## Start\nDEPLOY: ## Ship\ndeploy-prod: ## Ship\nrelease: ## [prod] Publish the app\nreset: ## [danger] Drop the data\nproduct: ## List\n",
    );
    expect(red(targets)).toEqual(["DEPLOY", "deploy-prod", "release", "reset"]);
    expect(targets.find((t) => t.label === "release")?.detail).toBe("Publish the app");
  });

  test("package scripts: capitals or prod in the name", () => {
    const scripts = parseScripts(JSON.stringify({ scripts: { dev: "vite", "deploy:prod": "x", "build:production": "x", MIGRATE: "x", "live-reload": "x" } }));
    expect(red(scripts)).toEqual(["MIGRATE", "build:production", "deploy:prod"]);
  });
});

describe("stats worker", () => {
  const sparkle = "Figxit/0.0.1 Sparkle/2.10.0";
  const browser = "Mozilla/5.0 (Macintosh)";

  test("counts update checks from the app only", () => {
    expect(classify("GET", "/appcast.xml", sparkle, null)).toEqual({ kind: "check", app: "0.0.1", file: "" });
    expect(classify("GET", "/appcast.xml", browser, null)).toBeNull();
    expect(classify("HEAD", "/appcast.xml", sparkle, null)).toBeNull();
  });

  test("counts installs and updates one time for each download", () => {
    expect(classify("GET", "/download/Figxit.dmg", browser, null)).toEqual({ kind: "install", app: "", file: "latest" });
    expect(classify("GET", "/download/Figxit-0.0.2.dmg", sparkle, null)).toEqual({ kind: "update", app: "0.0.1", file: "0.0.2" });
    expect(classify("GET", "/download/Figxit0.0.2-0.0.1.delta", sparkle, "bytes=0-")).toEqual({ kind: "update", app: "0.0.1", file: "0.0.2" });
    expect(classify("GET", "/download/Figxit-0.0.2.dmg", sparkle, "bytes=4096-")).toBeNull();
    expect(classify("GET", "/index.html", browser, null)).toBeNull();
  });
});

describe("safety", () => {
  test("secrets from history are not suggested", async () => {
    const cwd = project({});
    const history = historyOf([
      ["export API_KEY=abc123", cwd, 1],
      ["export NODE_ENV=production", cwd, 2],
      ["deploytool --token hunter2", cwd, 3],
      ["deploytool --region eu-west", cwd, 4],
      ["gh auth ghp_abcdefghijklmnopqrstuv", cwd, 5],
    ]);
    const exported = await suggest("export ", 7, cwd, history, NOW);
    expect(exported?.items.some((i) => i.pick)).toBe(false);
    expect(exported?.items.map((i) => i.label)).toEqual(["NODE_ENV=production"]);
    expect(await suggest("deploytool --token ", 19, cwd, history, NOW)).toBeNull();
    const region = await suggest("deploytool --region ", 20, cwd, history, NOW);
    expect(region?.items.map((i) => i.label)).toEqual(["eu-west"]);
    expect(secretLike("ghp_abcdefghijklmnopqrstuv")).toBe(true);
    expect(secretLike("feature-login")).toBe(false);
    expect(secretLike("hunter2", "-p")).toBe(true);
    expect(secretLike("postgres://app:hunter2@db.local/app")).toBe(true);
    expect(secretLike("DB_PASS=hunter2")).toBe(true);
    expect(secretLike("--author=sam")).toBe(false);
    expect(secretLike("keyboard=us")).toBe(false);
  });

  test("history words with spaces or shell syntax are not suggested", async () => {
    const cwd = project({});
    const history = historyOf([
      ["notes add 'fix login bug'", cwd, 1],
      ["notes add 'a|b'", cwd, 2],
      ["notes add plain", cwd, 3],
    ]);
    const result = await suggest("notes add ", 10, cwd, history, NOW);
    expect(result?.items.map((i) => i.label)).toEqual(["plain"]);
  });

  test("generators do not run when an earlier word has shell syntax", async () => {
    let runs = 0;
    registerSpec("multi", {
      name: "multi",
      args: {
        name: "item",
        isVariadic: true,
        generators: [
          {
            custom: async () => {
              runs++;
              return [{ name: "one" }];
            },
          },
        ],
      },
    });
    await suggest("multi a b", 9, "/", historyOf([]), NOW);
    expect(runs).toBe(1);
    await suggest('multi "$(touch x)" b', 20, "/", historyOf([]), NOW);
    await suggest('multi "a; b" c', 14, "/", historyOf([]), NOW);
    expect(runs).toBe(1);
  });

  test("no list opens for the next value of a repeating argument until a letter is typed", async () => {
    const cwd = project({ "README.md": "", "notes.txt": "" });
    registerSpec("show", { name: "show", args: { name: "file", isVariadic: true, template: "filepaths" } });
    const first = await suggest("show ", 5, cwd, historyOf([]), NOW);
    expect(first?.items.map((i) => i.label).sort()).toEqual(["README.md", "notes.txt"]);
    expect(await suggest("show README.md ", 15, cwd, historyOf([]), NOW)).toBeNull();
    const typed = await suggest("show README.md n", 16, cwd, historyOf([]), NOW);
    expect(typed?.items.map((i) => i.label)).toEqual(["notes.txt"]);
  });
});

describe("specs", () => {
  let customRuns = 0;
  registerSpec("tool", {
    name: "tool",
    subcommands: [
      {
        name: ["checkout", "co"],
        description: "Switch branch",
        args: {
          name: "branch",
          generators: [
            {
              custom: async () => {
                customRuns++;
                return [{ name: "main" }, { name: "feature-x", icon: "fig://icon?type=git" }];
              },
            },
          ],
        },
      },
      {
        name: "run",
        description: "Run a script",
        options: [
          { name: ["-e", "--env"], description: "Environment", args: { name: "env", suggestions: ["prod", "staging"] } },
          { name: "--watch" },
          { name: "--tag", requiresSeparator: true, args: { name: "tag" } },
          { name: "-v", isRepeatable: true },
        ],
        args: { name: "files", isVariadic: true, template: "filepaths" },
      },
      { name: "old", deprecated: true },
      { name: "secret", hidden: true },
      { name: "top", priority: 90, description: "High priority" },
    ],
    options: [{ name: "--verbose", isPersistent: true }, { name: "--root-only" }],
  });

  const labels = async (buffer: string, cwd = "/here", history = historyOf([])) =>
    ((await suggest(buffer, buffer.length, cwd, history, NOW))?.items ?? []).map((i) => i.label);

  test("lists subcommands by priority and hides deprecated and hidden ones", async () => {
    expect(await labels("tool ")).toEqual(["top", "checkout", "run"]);
  });

  test("matches a subcommand by its alias", async () => {
    expect(await labels("tool c")).toEqual(["checkout"]);
    expect(await labels("tool co")).toEqual([]);
  });

  test("a dash lists the options of the subcommand and persistent ones", async () => {
    expect((await labels("tool run -")).sort()).toEqual(["--tag", "--verbose", "--watch", "-e", "-v"]);
    expect((await labels("tool run --e"))[0]).toBe("--env");
  });

  test("used options are hidden unless they repeat", async () => {
    const after = await labels("tool run --watch -v -");
    expect(after).not.toContain("--watch");
    expect(after).toContain("-v");
  });

  test("an option with a separator inserts no space", async () => {
    const result = (await suggest("tool run --ta", 13, "/here", historyOf([]), NOW))!;
    expect(result.items[0]!.insert).toBe("--tag=");
  });

  test("an option argument limits the list to its suggestions", async () => {
    expect((await labels("tool run -e ")).sort()).toEqual(["prod", "staging"]);
  });

  test("a file template lists the directory and keeps folders open", async () => {
    const cwd = project({ "a.txt": "", "b c.txt": "" });
    await Bun.$`mkdir ${cwd}/sub`;
    const result = (await suggest("tool run -e prod ", 17, cwd, historyOf([]), NOW))!;
    const byLabel = new Map(result.items.map((i) => [i.label, i.insert]));
    expect([...byLabel.keys()].sort()).toEqual(["a.txt", "b c.txt", "sub/"]);
    expect(byLabel.get("sub/")).toBe("sub/");
    expect(byLabel.get("b c.txt")).toBe("b\\ c.txt ");
  });

  test("generator results arrive in the second phase and are cached", async () => {
    const first = await suggestAsync("tool checkout ", 14, "/gen", historyOf([]), NOW);
    expect(first.now).toBeNull();
    expect((await first.more)!.items.map((i) => i.label).sort()).toEqual(["feature-x", "main"]);
    const second = await suggestAsync("tool checkout f", 15, "/gen", historyOf([]), NOW + 100);
    expect(second.now!.items.map((i) => i.label)).toEqual(["feature-x"]);
    expect(second.more).toBeNull();
    expect(customRuns).toBe(1);
  });

  test("history from other directories is dropped when a spec covers the command", async () => {
    const history = historyOf([
      ["tool deploy", "/elsewhere"],
      ["tool ship", "/here"],
    ]);
    const result = await labels("tool ", "/here", history);
    expect(result).toContain("ship");
    expect(result).not.toContain("deploy");
  });

  test("history raises a subcommand through its alias", async () => {
    const history = historyOf([
      ["tool co main", "/here"],
      ["tool co main", "/here"],
    ]);
    expect((await labels("tool ", "/here", history))[0]).toBe("checkout");
  });
});

describe("parseTmux", () => {
  const pad = (term: string) => (term.includes("ghostty") ? { x: 10, y: 2 } : { x: 0, y: 0 });

  test("adds the pane offset and keeps the cell size", () => {
    expect(parseTmux("0 1 7 20 200 52 17 37 on bottom xterm-ghostty\n", pad)).toEqual({
      cols: 200,
      rows: 52,
      col: 7,
      row: 21,
      padX: 10,
      padY: 2,
      cellPxW: 17,
      cellPxH: 37,
    });
  });

  test("a status line at the top moves the row down", () => {
    expect(parseTmux("0 0 3 4 80 24 0 0 on top xterm-256color", pad)!.row).toBe(5);
    expect(parseTmux("0 0 3 4 80 24 0 0 2 top xterm-256color", pad)!.row).toBe(6);
  });

  test("rejects short output", () => {
    expect(parseTmux("", pad)).toBeNull();
  });
});
