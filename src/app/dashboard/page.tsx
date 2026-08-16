"use client";

import { Workspace } from "@/components/shell/workspace";

/**
 * The coach's workspace.
 *
 * One screen that matters, and it is the session: the tape pinned on the left,
 * Pep working down the right. Everything that used to be a separate
 * destination is now something he shows during it.
 */
export default function DashboardPage() {
  return (
    <main className="min-h-screen">
      <Workspace />
    </main>
  );
}
