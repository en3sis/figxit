interface Env {
  STATS: { writeDataPoint(point: { indexes: string[]; blobs: string[]; doubles: number[] }): void };
}

export interface Hit {
  kind: "check" | "install" | "update";
  app: string;
  file: string;
}

const APP = /^Figxit\/(\d+\.\d+\.\d+)/;
const IMAGE = /^\/download\/Figxit-?(\d+\.\d+\.\d+)[^/]*\.(dmg|delta)$/;

export function classify(method: string, path: string, agent: string | null, range: string | null): Hit | null {
  if (method !== "GET") return null;
  if (range && !range.startsWith("bytes=0-")) return null;
  const app = APP.exec(agent ?? "")?.[1] ?? "";
  if (path === "/appcast.xml") return app ? { kind: "check", app, file: "" } : null;
  if (path === "/download/Figxit.dmg") return { kind: "install", app: "", file: "latest" };
  const image = IMAGE.exec(path);
  if (image) return { kind: app ? "update" : "install", app, file: image[1]! };
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await fetch(request);
    try {
      const path = new URL(request.url).pathname;
      const hit =
        response.status < 400
          ? classify(request.method, path, request.headers.get("user-agent"), request.headers.get("range"))
          : null;
      if (hit) env.STATS.writeDataPoint({ indexes: [hit.kind], blobs: [hit.kind, hit.app, hit.file], doubles: [1] });
    } catch {}
    return response;
  },
};
