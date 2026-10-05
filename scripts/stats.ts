import { join } from "node:path";

const WORKER = "figxit-stats";
const DATASET = "figxit";
const API = "https://api.cloudflare.com/client/v4";

const account = process.env.CF_ACCOUNT;
const token = process.env.CF_TOKEN;
const host = new URL(process.env.SITE_URL || "https://figxit.com").host;

if (!account || !token) {
  console.error("Run this with make stats or make stats-deploy");
  process.exit(1);
}

async function call(path: string, init: RequestInit = {}): Promise<{ body: any; error: string }> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) },
  });
  const body = (await response.json().catch(() => null)) as any;
  if (response.ok && body?.success !== false) return { body, error: "" };
  return { body, error: body?.errors?.map((error: { message: string }) => error.message).join("; ") || response.statusText };
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const { body, error } = await call(path, init);
  if (error) {
    console.error(`${init.method ?? "GET"} ${path}: ${error}`);
    process.exit(1);
  }
  return body;
}

async function deploy() {
  const source = await Bun.file(join(import.meta.dir, "../worker/stats.ts")).text();
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  const upload = (bindings: object[]) => {
    const metadata = { main_module: "stats.js", compatibility_date: "2026-01-01", bindings };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("stats.js", new Blob([code], { type: "application/javascript+module" }), "stats.js");
    return call(`/accounts/${account}/workers/scripts/${WORKER}`, { method: "PUT", body: form });
  };
  let bound = true;
  let { error } = await upload([{ type: "analytics_engine", name: "STATS", dataset: DATASET }]);
  if (error.includes("enable Analytics Engine")) {
    bound = false;
    ({ error } = await upload([]));
  }
  if (error) {
    console.error(`upload of ${WORKER}: ${error}`);
    process.exit(1);
  }
  console.log(`uploaded ${WORKER}${bound ? "" : " without the data set binding"}`);

  const zone = (await api(`/zones?name=${host}`)).result?.[0]?.id;
  if (!zone) {
    console.error(`No Cloudflare zone for ${host}`);
    process.exit(1);
  }
  const routes: { pattern: string }[] = (await api(`/zones/${zone}/workers/routes`)).result ?? [];
  for (const pattern of [`${host}/appcast.xml`, `${host}/download/*`]) {
    if (routes.some((route) => route.pattern === pattern)) {
      console.log(`route ${pattern} exists`);
      continue;
    }
    await api(`/zones/${zone}/workers/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern, script: WORKER }),
    });
    console.log(`route ${pattern} added`);
  }
  if (!bound) {
    console.log(`
Analytics Engine is not enabled for this account, and only the dashboard can enable it.
1. Open https://dash.cloudflare.com/${account}/workers/services/view/${WORKER}/production/bindings
2. Add a binding: Analytics Engine, variable name STATS, dataset ${DATASET}. Deploy it there.
3. Run make stats-deploy again.
Downloads and updates work now. Counting starts after step 3.`);
  }
}

async function query(sql: string): Promise<Record<string, string>[]> {
  return (await api(`/accounts/${account}/analytics_engine/sql`, { method: "POST", body: sql })).data ?? [];
}

async function show(days: number) {
  const since = `timestamp > NOW() - INTERVAL '${days}' DAY`;
  const checks = await query(
    `SELECT toDate(timestamp) AS day, blob2 AS version, SUM(_sample_interval) AS installs FROM ${DATASET} WHERE blob1 = 'check' AND ${since} GROUP BY day, version ORDER BY day DESC, version DESC`,
  );
  const downloads = await query(
    `SELECT toDate(timestamp) AS day, blob1 AS kind, blob3 AS file, blob2 AS from_version, SUM(_sample_interval) AS downloads FROM ${DATASET} WHERE blob1 != 'check' AND ${since} GROUP BY day, kind, file, from_version ORDER BY day DESC, kind`,
  );
  console.log(`Update checks by day and version, last ${days} days. One check is about one install in use.`);
  console.table(checks);
  console.log("Downloads by day");
  console.table(downloads);
}

const [command, argument] = process.argv.slice(2);
if (command === "deploy") await deploy();
else if (command === "show") await show(Math.min(Math.max(Number(argument) || 14, 1), 90));
else {
  console.error("Usage: stats.ts deploy | show [days]");
  process.exit(1);
}
