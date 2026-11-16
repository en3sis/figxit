import { accessSync, constants } from "node:fs";
import { join } from "node:path";

const SESSION = ["WAYLAND_DISPLAY", "DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE"];

export async function launchApp(app: string, { background = true, args = [] as string[] } = {}): Promise<number> {
  if (process.platform === "darwin") {
    return run(["open", ...(background ? ["-g"] : []), app, ...(args.length ? ["--args", ...args] : [])]);
  }
  const helper = join(app, "Contents/MacOS/figxit-helper");
  try {
    accessSync(helper, constants.X_OK);
  } catch {
    return 1;
  }
  if (Bun.which("systemd-run")) {
    const session = SESSION.filter((name) => process.env[name]).map((name) => `--setenv=${name}`);
    const service = ["systemd-run", "--user", "--unit=figxit-helper", "--collect", "--quiet", "--property=Type=exec", ...session];
    if ((await run([...service, "--", helper, ...args])) === 0) return 0;
  }
  return run(["setsid", "-f", helper, ...args], "/");
}

async function run(command: string[], cwd?: string): Promise<number> {
  try {
    return await Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore", cwd }).exited;
  } catch {
    return 1;
  }
}
