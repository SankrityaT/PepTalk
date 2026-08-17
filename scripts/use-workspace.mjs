#!/usr/bin/env node
/**
 * Point the interface at one workspace's snapshots.
 *
 * TypeScript imports are static, so the app cannot choose a directory at
 * runtime. It imports from `snapshots/active`, and this copies the chosen
 * workspace into that directory before dev or build.
 *
 * The reason it exists: every workspace used to write to the same filenames.
 * A second workspace overwrote the first, and since the files are committed,
 * every merge between the two collided on all twelve of them. Namespacing by
 * key means two people can work on two teams and never touch each other's data.
 *
 *   PEPTALK_WORKSPACE=wc2022 node scripts/use-workspace.mjs
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshots = join(root, "src", "content", "snapshots");
const key = process.env.PEPTALK_WORKSPACE || "wc2022";
const from = join(snapshots, key);
const to = join(snapshots, "active");

if (!existsSync(from)) {
  const have = readdirSync(snapshots, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "active")
    .map((d) => d.name);
  console.error(
    `no snapshots for workspace "${key}".\n` +
      `  looked in: ${from}\n` +
      `  available: ${have.join(", ") || "none"}\n` +
      `  generate them with: uv run python -m tacticbench.roster --matches campaign`,
  );
  process.exit(1);
}

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`snapshots: ${key} -> active (${readdirSync(to).length} files)`);
