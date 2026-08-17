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
 * **Which workspace, in order of precedence.** The env var wins when it is
 * set, then whatever was added or selected last, then the built-in example.
 * That middle step is the important one: adding a game writes the pointer, so
 * the next `pnpm dev` opens on the coach's own match rather than resetting to
 * Argentina. Before it existed, every restart silently threw away the game
 * they had just added, and the only way back was an env var — which is a
 * developer's workaround, not a product.
 *
 *   node scripts/use-workspace.mjs                  # last used, or the example
 *   PEPTALK_WORKSPACE=mls23 node scripts/use-workspace.mjs
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshots = join(root, "src", "content", "snapshots");

/** Written by `tacticbench.snapshots.activate` when a game is added. */
const POINTER = join(snapshots, ".active");
const FALLBACK = "wc2022";

function lastUsed() {
  try {
    const key = readFileSync(POINTER, "utf8").trim();
    return key && existsSync(join(snapshots, key)) ? key : null;
  } catch {
    return null;
  }
}

const key = process.env.PEPTALK_WORKSPACE || lastUsed() || FALLBACK;
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
      `  add a game in the interface, or generate them with:\n` +
      `    PEPTALK_WORKSPACE=${key} uv run python -m tacticbench.bootstrap`,
  );
  process.exit(1);
}

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`snapshots: ${key} -> active (${readdirSync(to).length} files)`);
