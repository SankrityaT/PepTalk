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
 * **Which workspace.** The built-in World Cup game, unless an env var says
 * otherwise. Opening the dashboard always shows Argentina, because that is
 * the game a first-time visitor is meant to meet — it is the demo, and it is
 * the only one that exists before anybody has uploaded anything.
 *
 * Adding a game switches to it, and the sidebar switches back. Both of those
 * happen at runtime through `activate()`, which rewrites `active/` while the
 * app is running. Neither belongs here: this script sets the starting state,
 * and the starting state is the example. A previous version let the pointer
 * decide, so a restart re-opened whatever had been looked at last — which
 * quietly made one coach's uploaded match the front door of the whole app.
 *
 *   node scripts/use-workspace.mjs                  # the built-in example
 *   PEPTALK_WORKSPACE=mls23 node scripts/use-workspace.mjs
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshots = join(root, "src", "content", "snapshots");

/** The game every fresh open lands on. */
const FALLBACK = "wc2022";

const key = process.env.PEPTALK_WORKSPACE || FALLBACK;
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
// Say what `active/` now holds. The switcher reads this to tick the current
// game, and a stale value left over from a previous session would show the
// coach one game while highlighting another.
writeFileSync(join(snapshots, ".active"), `${key}\n`);
console.log(`snapshots: ${key} -> active (${readdirSync(to).length} files)`);
