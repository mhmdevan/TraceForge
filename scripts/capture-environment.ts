import { execFileSync } from "node:child_process";
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Captures the exact hardware/software environment the experiments ran on, so a
// reviewer can judge comparability and a re-runner can match conditions. Writes
// results/environment.json. Part of the reproducibility artifact.

// Image repositories used across the experiments and compose stack (pinned tags).
const TRACKED_IMAGE_REPOS = [
  "postgres",
  "mongo",
  "redis",
  "rabbitmq",
  "prom/prometheus",
  "grafana/grafana",
  "grafana/loki",
  "grafana/k6",
  "jaegertracing/all-in-one",
  "otel/opentelemetry-collector-contrib",
  "curlimages/curl"
];

function tryExec(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unknown";
  }
}

function trackedImages(): Array<{ repository: string; tag: string; digest: string }> {
  const raw = tryExec("docker", ["images", "--digests", "--format", "{{json .}}"]);
  if (raw === "unknown" || raw === "") {
    return [];
  }
  const rows = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, string>);
  return rows
    .filter((row) => TRACKED_IMAGE_REPOS.includes(row.Repository))
    .map((row) => ({
      repository: row.Repository,
      tag: row.Tag,
      digest: row.Digest
    }))
    .sort((a, b) => `${a.repository}:${a.tag}`.localeCompare(`${b.repository}:${b.tag}`));
}

async function main(): Promise<void> {
  const cpus = os.cpus();
  const environment = {
    capturedAt: new Date().toISOString(),
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch()
    },
    cpu: {
      model: cpus[0]?.model ?? "unknown",
      logicalCores: cpus.length,
      speedMHz: cpus[0]?.speed ?? 0
    },
    memoryBytes: os.totalmem(),
    runtime: {
      node: process.version,
      pnpm: tryExec("pnpm", ["-v"])
    },
    docker: {
      version: tryExec("docker", ["--version"]),
      composeVersion: tryExec("docker", ["compose", "version", "--short"])
    },
    git: {
      commit: tryExec("git", ["rev-parse", "HEAD"]),
      shortCommit: tryExec("git", ["rev-parse", "--short", "HEAD"]),
      dirty: tryExec("git", ["status", "--porcelain"]).length > 0
    },
    images: trackedImages()
  };

  const outDir = resolve(process.cwd(), "results");
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, "environment.json");
  await writeFile(outPath, `${JSON.stringify(environment, null, 2)}\n`);

  console.log(`Environment captured -> ${outPath}`);
  console.log(
    `  ${environment.os.platform}/${environment.os.arch}, ${environment.cpu.logicalCores} cores, ` +
      `${(environment.memoryBytes / 1024 ** 3).toFixed(1)} GiB RAM`
  );
  console.log(`  node ${environment.runtime.node}, pnpm ${environment.runtime.pnpm}`);
  console.log(`  ${environment.docker.version}`);
  console.log(
    `  git ${environment.git.shortCommit}${environment.git.dirty ? " (dirty)" : ""}`
  );
  console.log(`  ${environment.images.length} tracked images recorded`);
}

void main();
