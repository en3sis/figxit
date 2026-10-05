import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const app = join(import.meta.dir, "../../dist/Figxit.app");
const cli = join(app, "Contents/MacOS/figxit-engine");
const work = mkdtempSync("/tmp/fxa-");
const env = {
  ...process.env,
  FIGXIT_SOCK: join(work, "e.sock"),
  FIGXIT_HELPER_SOCK: join(work, "h.sock"),
} as Record<string, string>;
delete env.FIGXIT_APP;
delete env.FIGXIT_SPECS;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " -> " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};
const run = (...args: string[]) => {
  const result = Bun.spawnSync([cli, ...args], { env, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
};
const children = (pid: number) =>
  Bun.spawnSync(["pgrep", "-P", String(pid), "-l"], { stdout: "pipe" }).stdout.toString().trim();

const flag = join(work, "stopped");
await Bun.write(flag, "");
const helper = Bun.spawn([join(app, "Contents/MacOS/figxit-helper")], { env, stdout: "ignore", stderr: "ignore" });
try {
  await Bun.sleep(2500);
  check("the helper opens its socket", existsSync(env.FIGXIT_HELPER_SOCK!));
  check("the helper starts the engine", existsSync(env.FIGXIT_SOCK!));
  check("opening the app clears the stop flag", !existsSync(flag));
  check("the engine is a child of the helper", children(helper.pid).includes("figxit-engine"), children(helper.pid));

  const version = run("--version");
  check("--version prints the version", /^\d+\.\d+\.\d+\n$/.test(version.out), version);
  check("no arguments prints help and does not start a daemon", run().out.includes("figxit init zsh"));
  check("an unknown command fails", run("nope").code === 1);
  check("init needs a known shell", run("init", "nope").code === 1);
  for (const shell of ["bash", "fish"]) {
    const lines = run("init", shell);
    check(`init ${shell} prints the adapter path`, lines.code === 0 && lines.out.includes(`shell/${shell}/figxit.${shell}`), lines);
  }

  const init = run("init", "zsh");
  check("init prints the app path", init.out.includes(`export FIGXIT_APP="${app}"`), init);
  const loaded = Bun.spawnSync(["zsh", "-ic", `eval "$(${cli} init zsh)"; print -r -- "$FIGXIT_APP|$+widgets[figxit-tab]"`], {
    env: { ...env, ZDOTDIR: work },
    stdout: "pipe",
    stderr: "pipe",
  });
  check("the init lines load the adapter in zsh", loaded.stdout.toString().trim() === `${app}|1`, loaded.stdout.toString());

  const doctor = run("doctor");
  check("doctor reports the helper, engine, and specs", /ok\s+popup helper/.test(doctor.out) && /ok\s+engine/.test(doctor.out) && /ok\s+completion specs\s+\d{3}/.test(doctor.out), doctor.out);
  console.log(doctor.out.trimEnd().replace(/^/gm, "     "));

  const enginePid = Number(children(helper.pid).split(" ")[0]);
  process.kill(enginePid, "SIGKILL");
  await Bun.sleep(2500);
  const restarted = children(helper.pid);
  check("the helper restarts a crashed engine", restarted.includes("figxit-engine") && !restarted.startsWith(String(enginePid)), restarted);

  const stopped = run("stop");
  await Bun.sleep(500);
  check("stop ends the helper and the engine", stopped.out.includes("stopped") && helper.exitCode !== null && children(helper.pid) === "", { stopped, exit: helper.exitCode });
  check("stop leaves the stop flag, so shells do not start the app again", existsSync(flag));
  check("stop removes the sockets from use", run("doctor").out.includes("--   popup helper"));
} finally {
  helper.kill();
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
