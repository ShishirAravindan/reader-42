import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { WORKSPACES_DIR } from '../data-paths.ts';
import { db } from '../db/client.ts';
import { items } from '../db/schema.ts';

/**
 * Stub for the headless-CC convert worker.
 *
 * v1 sets up the per-item workspace dir but does not yet spawn `claude -p`.
 * The real subprocess invocation lands when the convert-workspace template is
 * built (see docs/decisions/0002-convert-as-agent.md and the corresponding task).
 */
export async function enqueueConvert(itemId: string): Promise<void> {
  const workspacePath = path.join(WORKSPACES_DIR, itemId);
  fs.mkdirSync(path.join(workspacePath, 'source'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'output'), { recursive: true });

  await db.update(items).set({ workspacePath, updatedAt: new Date() }).where(eq(items.id, itemId));

  console.log(`[convert] workspace prepared for ${itemId} at ${workspacePath} (subprocess stub)`);
}
