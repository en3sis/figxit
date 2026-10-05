import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Socket } from "bun";
import { appPath, HELPER_SOCK } from "./paths";

const SOCK = HELPER_SOCK;

export class Helper {
  private socket: Socket | null = null;
  private connecting: Promise<boolean> | null = null;
  private launchedAt = 0;
  private pending = "";
  onHidden: (() => void) | null = null;

  private receive(chunk: Buffer) {
    this.pending += chunk.toString();
    let newline: number;
    while ((newline = this.pending.indexOf("\n")) >= 0) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      if (line.includes('"event":"hidden"')) this.onHidden?.();
    }
  }

  private async open(): Promise<boolean> {
    try {
      this.socket = await Bun.connect({
        unix: SOCK,
        socket: {
          data: (_socket, chunk) => this.receive(chunk),
          close: () => {
            this.socket = null;
          },
          error: () => {
            this.socket = null;
          },
        },
      });
      return true;
    } catch {
      this.socket = null;
      return false;
    }
  }

  private async connect(): Promise<boolean> {
    if (this.socket) return true;
    if (await this.open()) return true;
    const app = appPath();
    if (!app || existsSync(join(dirname(SOCK), "stopped")) || Date.now() - this.launchedAt < 5000) return false;
    this.launchedAt = Date.now();
    Bun.spawn(["open", "-g", app], { stdout: "ignore", stderr: "ignore" });
    for (let attempt = 0; attempt < 20; attempt++) {
      await Bun.sleep(100);
      if (await this.open()) return true;
    }
    return false;
  }

  async notify(message: object): Promise<void> {
    if (this.socket || (await this.open())) this.socket?.write(JSON.stringify(message) + "\n");
  }

  async send(message: object): Promise<void> {
    if (!this.socket) {
      this.connecting ??= this.connect().finally(() => {
        this.connecting = null;
      });
      if (!(await this.connecting)) return;
    }
    this.socket?.write(JSON.stringify(message) + "\n");
  }
}
