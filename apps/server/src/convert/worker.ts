import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { EPUBS_DIR, WORKSPACES_DIR, ensureDataDirs } from '../data-paths.ts';
import { db } from '../db/client.ts';
import { items } from '../db/schema.ts';
import { TEMPLATE_DIR } from './template.ts';

const DEFAULT_BUDGET_USD = Number(Bun.env.CONVERT_MAX_BUDGET_USD ?? 2);
const DEFAULT_WALL_CLOCK_MS = Number(Bun.env.CONVERT_WALL_CLOCK_MS ?? 30 * 60 * 1000);
const ALLOWED_TOOLS = 'Bash Read Write Edit Grep Glob WebFetch';

type Manifest = {
  item_id: string;
  source_type: 'url' | 'pdf' | 'url_series';
  source_ref: string;
  urls?: string[];
};

type ConvertResult =
  | { ok: true; epubPath: string; reportPath: string; report: ConvertReport }
  | {
      ok: false;
      reason: 'paused' | 'quarantined';
      reportPath: string | null;
      report: ConvertReport | null;
    };

type ConvertReport = {
  item_id: string;
  source_type: string;
  stages: Record<string, { status: string }>;
  findings: Array<{ severity: 'warn' | 'fail'; human_message: string }>;
  metadata?: { title?: string; author?: string };
};

function copyTemplate(targetDir: string): void {
  fs.cpSync(TEMPLATE_DIR, targetDir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(TEMPLATE_DIR, src);
      // Skip the template's own .gitignore — it's repo-level metadata, not workspace runtime.
      return rel !== '.gitignore';
    },
  });
}

function writeManifest(workspacePath: string, manifest: Manifest): void {
  fs.writeFileSync(path.join(workspacePath, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function spawnConvertAgent(
  workspacePath: string,
): Promise<{ exitCode: number; timedOut: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_WALL_CLOCK_MS);

  const proc = Bun.spawn(
    [
      'claude',
      '--print',
      '--output-format',
      'json',
      '--permission-mode',
      'bypassPermissions',
      '--max-budget-usd',
      String(DEFAULT_BUDGET_USD),
      '--allowed-tools',
      ALLOWED_TOOLS,
      'Read CLAUDE.md and run the conversion per its spec. Write output/book.epub and output/report.json. Exit non-zero on hard failure.',
    ],
    {
      cwd: workspacePath,
      stdout: 'pipe',
      stderr: 'pipe',
      signal: controller.signal,
    },
  );

  let timedOut = false;
  try {
    await proc.exited;
  } catch {
    timedOut = true;
  } finally {
    clearTimeout(timeout);
  }

  return { exitCode: proc.exitCode ?? -1, timedOut };
}

function readReport(workspacePath: string): ConvertReport | null {
  const reportPath = path.join(workspacePath, 'output', 'report.json');
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ConvertReport;
  } catch {
    return null;
  }
}

function classifyFailure(
  report: ConvertReport | null,
  timedOut: boolean,
): 'paused' | 'quarantined' {
  if (timedOut) return 'paused';
  if (!report) return 'paused';
  const hasFail = report.findings?.some((f) => f.severity === 'fail');
  return hasFail ? 'quarantined' : 'paused';
}

async function runConvert(itemId: string): Promise<ConvertResult> {
  ensureDataDirs();
  const workspacePath = path.join(WORKSPACES_DIR, itemId);

  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
  copyTemplate(workspacePath);

  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (!item) throw new Error(`item ${itemId} not found`);

  const manifest: Manifest =
    item.sourceType === 'url_series'
      ? {
          item_id: itemId,
          source_type: 'url_series',
          source_ref: item.sourceRef,
          urls: JSON.parse(item.sourceRef) as string[],
        }
      : { item_id: itemId, source_type: item.sourceType, source_ref: item.sourceRef };

  writeManifest(workspacePath, manifest);

  await db
    .update(items)
    .set({ state: 'converting', workspacePath, updatedAt: new Date() })
    .where(eq(items.id, itemId));

  const { exitCode, timedOut } = await spawnConvertAgent(workspacePath);
  const report = readReport(workspacePath);
  const reportPath = report ? path.join(workspacePath, 'output', 'report.json') : null;

  if (exitCode !== 0 || timedOut) {
    return { ok: false, reason: classifyFailure(report, timedOut), reportPath, report };
  }

  const epubSrcPath = path.join(workspacePath, 'output', 'book.epub');
  if (!fs.existsSync(epubSrcPath)) {
    return { ok: false, reason: 'quarantined', reportPath, report };
  }

  const epubDestPath = path.join(EPUBS_DIR, `${itemId}.epub`);
  fs.copyFileSync(epubSrcPath, epubDestPath);

  if (!report) {
    return { ok: false, reason: 'quarantined', reportPath: null, report: null };
  }
  return { ok: true, epubPath: epubDestPath, reportPath: reportPath ?? '', report };
}

export async function enqueueConvert(itemId: string): Promise<void> {
  console.log(`[convert] starting ${itemId}`);

  try {
    const result = await runConvert(itemId);

    if (result.ok) {
      await db
        .update(items)
        .set({
          state: 'ready',
          paused: false,
          quarantined: false,
          epubPath: result.epubPath,
          reportPath: result.reportPath,
          title: result.report.metadata?.title ?? null,
          author: result.report.metadata?.author ?? null,
          updatedAt: new Date(),
        })
        .where(eq(items.id, itemId));

      console.log(`[convert] ${itemId} ready at ${result.epubPath}`);
    } else {
      await db
        .update(items)
        .set({
          paused: result.reason === 'paused',
          quarantined: result.reason === 'quarantined',
          reportPath: result.reportPath,
          updatedAt: new Date(),
        })
        .where(eq(items.id, itemId));

      console.log(`[convert] ${itemId} ${result.reason}`);
    }
  } catch (err) {
    console.error(`[convert] ${itemId} unexpected error:`, err);
    await db.update(items).set({ paused: true, updatedAt: new Date() }).where(eq(items.id, itemId));
  }
}
