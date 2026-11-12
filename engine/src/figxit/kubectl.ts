import type { Spec } from "../specs";

export const COMMON_RESOURCES: Spec[] = [
  { name: "pods", description: "Pods", priority: 95 },
  { name: "po", description: "Pods (short)", priority: 95 },
  { name: "deployments", description: "Deployments", priority: 90 },
  { name: "deploy", description: "Deployments (short)", priority: 90 },
  { name: "services", description: "Services", priority: 90 },
  { name: "svc", description: "Services (short)", priority: 90 },
  { name: "configmaps", description: "ConfigMaps", priority: 85 },
  { name: "cm", description: "ConfigMaps (short)", priority: 85 },
  { name: "namespaces", description: "Namespaces", priority: 85 },
  { name: "ns", description: "Namespaces (short)", priority: 85 },
  { name: "nodes", description: "Nodes", priority: 80 },
  { name: "no", description: "Nodes (short)", priority: 80 },
  { name: "secrets", description: "Secrets", priority: 80 },
  { name: "ingresses", description: "Ingresses", priority: 75 },
  { name: "ing", description: "Ingresses (short)", priority: 75 },
  { name: "statefulsets", description: "StatefulSets", priority: 75 },
  { name: "sts", description: "StatefulSets (short)", priority: 75 },
  { name: "daemonsets", description: "DaemonSets", priority: 75 },
  { name: "ds", description: "DaemonSets (short)", priority: 75 },
  { name: "persistentvolumeclaims", description: "PersistentVolumeClaims", priority: 70 },
  { name: "pvc", description: "PersistentVolumeClaims (short)", priority: 70 },
  { name: "persistentvolumes", description: "PersistentVolumes", priority: 70 },
  { name: "pv", description: "PersistentVolumes (short)", priority: 70 },
  { name: "serviceaccounts", description: "ServiceAccounts", priority: 70 },
  { name: "sa", description: "ServiceAccounts (short)", priority: 70 },
  { name: "jobs", description: "Jobs", priority: 65 },
  { name: "cronjobs", description: "CronJobs", priority: 65 },
  { name: "cj", description: "CronJobs (short)", priority: 65 },
  { name: "events", description: "Events", priority: 60 },
  { name: "ev", description: "Events (short)", priority: 60 },
  { name: "endpoints", description: "Endpoints", priority: 60 },
  { name: "ep", description: "Endpoints (short)", priority: 60 },
  { name: "customresourcedefinitions", description: "CustomResourceDefinitions", priority: 60 },
  { name: "crd", description: "CustomResourceDefinitions (short)", priority: 60 },
  { name: "horizontalpodautoscalers", description: "HorizontalPodAutoscalers", priority: 60 },
  { name: "hpa", description: "HorizontalPodAutoscalers (short)", priority: 60 },
  { name: "roles", description: "Roles", priority: 55 },
  { name: "rolebindings", description: "RoleBindings", priority: 55 },
  { name: "clusterroles", description: "ClusterRoles", priority: 55 },
  { name: "clusterrolebindings", description: "ClusterRoleBindings", priority: 55 },
  { name: "networkpolicies", description: "NetworkPolicies", priority: 55 },
  { name: "netpol", description: "NetworkPolicies (short)", priority: 55 },
  { name: "storageclasses", description: "StorageClasses", priority: 55 },
  { name: "sc", description: "StorageClasses (short)", priority: 55 },
];

const KNOWN_OPTS_WITH_ARG = new Set([
  "-n",
  "--namespace",
  "--context",
  "--cluster",
  "--user",
  "--kubeconfig",
  "-l",
  "--selector",
  "-f",
  "--filename",
  "-k",
  "--kustomize",
  "-o",
  "--output",
  "--field-selector",
  "-c",
  "--container",
  "--sort-by",
  "--request-timeout",
]);

const RESOURCE_SUBCMDS = new Set([
  "get",
  "describe",
  "delete",
  "edit",
  "logs",
  "scale",
  "autoscale",
  "expose",
  "label",
  "patch",
  "port-forward",
  "exec",
  "top",
  "attach",
  "cordon",
  "drain",
  "taint",
  "uncordon",
  "apply",
  "set",
  "rollout",
  "auth",
]);

export function extractKubectlContext(tokens: string[]): {
  subcmd: string | null;
  resourceType: string | null;
  positionals: string[];
  flags: string[];
  connectionFlags: string[];
} {
  const flags: string[] = [];
  const connectionFlags: string[] = [];

  let subcmdIndex = -1;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (RESOURCE_SUBCMDS.has(t) && subcmdIndex === -1) {
      subcmdIndex = i;
      break;
    }
  }

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "--context" || t === "--kubeconfig" || t === "--cluster" || t === "--user") {
      const next = tokens[i + 1];
      if (next && !next.startsWith("-")) {
        flags.push(t, next);
        connectionFlags.push(t, next);
        i++;
      }
    } else if (
      t.startsWith("--context=") ||
      t.startsWith("--kubeconfig=") ||
      t.startsWith("--cluster=") ||
      t.startsWith("--user=")
    ) {
      flags.push(t);
      connectionFlags.push(t);
    } else if (t === "-n" || t === "--namespace") {
      const next = tokens[i + 1];
      if (next && !next.startsWith("-")) {
        flags.push(t, next);
        i++;
      }
    } else if (t.startsWith("-n=") || t.startsWith("--namespace=")) {
      flags.push(t);
    } else if (t === "-A" || t === "--all-namespaces") {
      flags.push(t);
    } else if (t === "-l" || t === "--selector") {
      const next = tokens[i + 1];
      if (next && !next.startsWith("-")) {
        flags.push(t, next);
        i++;
      }
    } else if (t.startsWith("-l=") || t.startsWith("--selector=")) {
      flags.push(t);
    }
  }

  const positionals: string[] = [];
  if (subcmdIndex !== -1) {
    for (let i = subcmdIndex + 1; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.startsWith("-")) {
        if (KNOWN_OPTS_WITH_ARG.has(t)) {
          i++;
        }
      } else if (t !== "") {
        positionals.push(t);
      }
    }
  }

  return {
    subcmd: subcmdIndex !== -1 ? tokens[subcmdIndex]! : null,
    resourceType: positionals[0] ?? null,
    positionals,
    flags,
    connectionFlags,
  };
}

function parseResourceNames(stdout: string, stripPrefix = true, alreadyTyped: Set<string> = new Set()): Spec[] {
  if (!stdout || stdout.includes("error:") || stdout.includes("The connection to the server")) return [];
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const out: Spec[] = [];
  for (const line of lines) {
    const slash = line.indexOf("/");
    const name = stripPrefix && slash >= 0 ? line.slice(slash + 1) : line;
    if (!name || alreadyTyped.has(name)) continue;
    out.push({
      name,
      icon: "fig://icon?type=kubernetes",
    });
  }
  return out;
}

export const namespaceGenerator: Spec = {
  script: (tokens: string[]) => {
    const { connectionFlags } = extractKubectlContext(tokens);
    return ["kubectl", ...connectionFlags, "get", "namespaces", "-o", "name"];
  },
  postProcess: (stdout: string) => {
    if (!stdout || stdout.includes("error:") || stdout.includes("The connection to the server")) return [];
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const name = l.replace(/^namespace\//, "");
        return {
          name,
          description: "namespace",
          priority: name === "default" ? 95 : 75,
          icon: "fig://icon?type=kubernetes",
        };
      });
  },
  cache: { strategy: "stale-while-revalidate", ttl: 30000 },
};

export const contextGenerator: Spec = {
  script: (tokens: string[]) => {
    const { connectionFlags } = extractKubectlContext(tokens);
    const kubeconfigOnly = connectionFlags.filter((f) => f.startsWith("--kubeconfig"));
    return ["kubectl", ...kubeconfigOnly, "config", "get-contexts", "-o", "name"];
  },
  postProcess: (stdout: string) => {
    if (!stdout || stdout.includes("error:")) return [];
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((name) => ({
        name,
        description: "context",
        icon: "fig://icon?type=kubernetes",
      }));
  },
  cache: { strategy: "stale-while-revalidate", ttl: 30000 },
};

export const clusterGenerator: Spec = {
  script: (tokens: string[]) => {
    const { connectionFlags } = extractKubectlContext(tokens);
    const kubeconfigOnly = connectionFlags.filter((f) => f.startsWith("--kubeconfig"));
    return ["kubectl", ...kubeconfigOnly, "config", "get-clusters"];
  },
  postProcess: (stdout: string) => {
    if (!stdout || stdout.includes("error:")) return [];
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "NAME")
      .map((name) => ({
        name,
        description: "cluster",
        icon: "fig://icon?type=kubernetes",
      }));
  },
  cache: { strategy: "stale-while-revalidate", ttl: 30000 },
};

export const resourceTypeOrSlashGenerator: Spec = {
  script: (tokens: string[]) => {
    const last = tokens[tokens.length - 1] ?? "";
    if (last.includes("/")) {
      const type = last.slice(0, last.indexOf("/"));
      const { flags } = extractKubectlContext(tokens);
      return ["kubectl", ...flags, "get", type, "-o", "name"];
    }
    const { connectionFlags } = extractKubectlContext(tokens);
    return ["kubectl", ...connectionFlags, "api-resources", "-o", "name"];
  },
  postProcess: (stdout: string) => {
    return parseResourceNames(stdout, true);
  },
  trigger: "/",
  getQueryTerm: "/",
  cache: { strategy: "stale-while-revalidate", ttl: 60000 },
};

export const resourceInstanceGenerator: Spec = {
  script: (tokens: string[]) => {
    const last = tokens[tokens.length - 1] ?? "";
    const { resourceType, flags, subcmd } = extractKubectlContext(tokens);
    let targetType = resourceType;
    if (last.includes("/")) {
      targetType = last.slice(0, last.indexOf("/"));
    } else if (!targetType && (subcmd === "logs" || subcmd === "attach")) {
      targetType = "pods";
    }
    if (!targetType) return [];
    targetType = targetType.replace(/\/+$/, "");
    return ["kubectl", ...flags, "get", targetType, "-o", "name"];
  },
  postProcess: (stdout: string, tokens: string[]) => {
    const { positionals } = extractKubectlContext(tokens);
    const alreadyTyped = new Set(positionals.slice(1));
    return parseResourceNames(stdout, true, alreadyTyped);
  },
  trigger: "/",
  getQueryTerm: "/",
  cache: { strategy: "stale-while-revalidate", ttl: 5000 },
};

export const runningPodsGenerator: Spec = {
  script: (tokens: string[]) => {
    const { flags } = extractKubectlContext(tokens);
    return ["kubectl", ...flags, "get", "pods", "--field-selector=status.phase=Running", "-o", "name"];
  },
  postProcess: (stdout: string) => parseResourceNames(stdout, true),
  cache: { strategy: "stale-while-revalidate", ttl: 5000 },
};

export const nodeGenerator: Spec = {
  script: (tokens: string[]) => {
    const { connectionFlags } = extractKubectlContext(tokens);
    return ["kubectl", ...connectionFlags, "get", "nodes", "-o", "name"];
  },
  postProcess: (stdout: string) => parseResourceNames(stdout, true),
  cache: { strategy: "stale-while-revalidate", ttl: 15000 },
};

export const workloadGenerator: Spec = {
  script: (tokens: string[]) => {
    const { flags } = extractKubectlContext(tokens);
    return ["kubectl", ...flags, "get", "deployments,daemonsets,statefulsets", "-o", "name"];
  },
  postProcess: (stdout: string) => parseResourceNames(stdout, false),
  cache: { strategy: "stale-while-revalidate", ttl: 10000 },
};

export function kubectl(spec: Spec): Spec {
  const options: Spec[] = Array.isArray(spec.options) ? spec.options : [];

  let nOpt = options.find((o) => {
    const names = Array.isArray(o.name) ? o.name : [o.name];
    return names.includes("-n") || names.includes("--namespace");
  });
  if (nOpt) {
    nOpt.isPersistent = true;
    nOpt.args = {
      name: "namespace",
      generators: namespaceGenerator,
    };
  } else {
    nOpt = {
      name: ["-n", "--namespace"],
      description: "If present, the namespace scope for this CLI request",
      isPersistent: true,
      args: { name: "namespace", generators: namespaceGenerator },
    };
    options.push(nOpt);
  }

  let contextOpt = options.find((o) => {
    const names = Array.isArray(o.name) ? o.name : [o.name];
    return names.includes("--context");
  });
  if (contextOpt) {
    contextOpt.isPersistent = true;
    contextOpt.args = { name: "context", generators: contextGenerator };
  } else {
    options.push({
      name: "--context",
      description: "The name of the kubeconfig context to use",
      isPersistent: true,
      args: { name: "context", generators: contextGenerator },
    });
  }

  let kubeconfigOpt = options.find((o) => {
    const names = Array.isArray(o.name) ? o.name : [o.name];
    return names.includes("--kubeconfig");
  });
  if (kubeconfigOpt) {
    kubeconfigOpt.isPersistent = true;
    kubeconfigOpt.args = { name: "file", template: "filepaths" };
  } else {
    options.push({
      name: "--kubeconfig",
      description: "Path to the kubeconfig file to use for CLI requests",
      isPersistent: true,
      args: { name: "file", template: "filepaths" },
    });
  }

  let allNsOpt = options.find((o) => {
    const names = Array.isArray(o.name) ? o.name : [o.name];
    return names.includes("-A") || names.includes("--all-namespaces");
  });
  if (allNsOpt) {
    allNsOpt.isPersistent = true;
  } else {
    options.push({
      name: ["-A", "--all-namespaces"],
      description: "If present, list the requested object(s) across all namespaces",
      isPersistent: true,
    });
  }

  spec.options = options;

  const subcommands: Spec[] = Array.isArray(spec.subcommands) ? spec.subcommands : [];

  const patchResourceArgs = (sub: Spec) => {
    if (!Array.isArray(sub.args)) return;
    if (sub.args[0]) {
      sub.args[0] = {
        ...sub.args[0],
        suggestions: COMMON_RESOURCES,
        generators: resourceTypeOrSlashGenerator,
      };
    }
    if (sub.args[1]) {
      sub.args[1] = {
        ...sub.args[1],
        isOptional: true,
        isVariadic: true,
        generators: resourceInstanceGenerator,
      };
    }
  };

  for (const sub of subcommands) {
    const name = typeof sub.name === "string" ? sub.name : Array.isArray(sub.name) ? sub.name[0] : "";
    if (
      [
        "get",
        "describe",
        "delete",
        "edit",
        "scale",
        "autoscale",
        "expose",
        "label",
        "patch",
        "port-forward",
      ].includes(name)
    ) {
      patchResourceArgs(sub);
    } else if (name === "logs") {
      if (Array.isArray(sub.args) && sub.args[0]) {
        sub.args[0] = {
          ...sub.args[0],
          generators: resourceInstanceGenerator,
        };
      }
    } else if (name === "exec" || name === "attach") {
      if (Array.isArray(sub.args) && sub.args[0]) {
        sub.args[0].generators = runningPodsGenerator;
      } else if (sub.args) {
        sub.args.generators = runningPodsGenerator;
      }
    } else if (["cordon", "drain", "taint", "uncordon"].includes(name)) {
      if (Array.isArray(sub.args) && sub.args[0]) {
        sub.args[0].generators = nodeGenerator;
      } else if (sub.args) {
        sub.args.generators = nodeGenerator;
      }
    } else if (name === "rollout" && Array.isArray(sub.subcommands)) {
      for (const nested of sub.subcommands) {
        if (Array.isArray(nested.args) && nested.args[0]) {
          nested.args[0].generators = workloadGenerator;
        } else if (nested.args) {
          nested.args.generators = workloadGenerator;
        }
      }
    } else if (name === "config" && Array.isArray(sub.subcommands)) {
      for (const nested of sub.subcommands) {
        const nestedName = nested.name;
        if (["use-context", "delete-context", "get-contexts", "rename-context", "set-context"].includes(nestedName)) {
          if (Array.isArray(nested.args) && nested.args[0]) {
            nested.args[0].generators = contextGenerator;
          } else if (nested.args) {
            nested.args.generators = contextGenerator;
          }
        } else if (["delete-cluster", "set-credentials"].includes(nestedName)) {
          if (Array.isArray(nested.args) && nested.args[0]) {
            nested.args[0].generators = clusterGenerator;
          } else if (nested.args) {
            nested.args.generators = clusterGenerator;
          }
        }
      }
    } else if (["apply", "set"].includes(name) && Array.isArray(sub.subcommands)) {
      for (const nested of sub.subcommands) {
        patchResourceArgs(nested);
      }
    }
  }

  return spec;
}
