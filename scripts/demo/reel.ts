// Stitching a demo out of more than one kind of footage.
//
// The product is two programs. A recording of only the browser half would be a
// recording of half the product — so the reel splices real KOReader footage,
// captured off the X display it actually runs on, between the browser acts.
//
// Segments are recorded separately, normalized to one frame size, concatenated,
// and only then narrated. Narration is mixed last, against absolute offsets
// computed from the measured length of each segment, so a line lands where it
// was spoken no matter how long the segment before it turned out to be. Timing
// something by hand across a cut is how demos end up out of sync.

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type NarrationLine, mixNarration } from './voice.ts';

/** One frame size for the whole reel; portrait footage is padded into it. */
export const FRAME = { width: 1280, height: 800 };
const BG = '0x12110f';

export interface Segment {
  /** Video on disk, any size. */
  video: string;
  /** Narration recorded against THIS segment's own clock. */
  lines: NarrationLine[];
}

function run(args: string[]): void {
  const proc = Bun.spawnSync(args, { stderr: 'pipe' });
  if (proc.exitCode !== 0) {
    throw new Error(`${args[0]} failed:\n${proc.stderr.toString().slice(0, 800)}`);
  }
}

export function durationMs(file: string): number {
  const probe = Bun.spawnSync([
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]);
  return Math.round(Number(probe.stdout.toString().trim()) * 1000) || 0;
}

/**
 * Record an X display while a driver script works on it.
 *
 * This is how KOReader gets into the reel: it is a real application on a real
 * (virtual) screen, so the only honest way to film it is to film the screen.
 * The driver runs as a child, and capture stops when it returns.
 */
export async function recordDisplay(
  display: string,
  size: { width: number; height: number },
  out: string,
  drive: () => Promise<void>,
): Promise<string> {
  rmSync(out, { force: true });
  const capture = Bun.spawn(
    [
      'ffmpeg',
      '-y',
      '-v',
      'error',
      '-f',
      'x11grab',
      '-framerate',
      '15',
      '-video_size',
      `${size.width}x${size.height}`,
      '-i',
      display,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      out,
    ],
    { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' },
  );

  try {
    await drive();
  } finally {
    // 'q' is ffmpeg's own clean stop: it flushes and writes a valid moov atom.
    // Killing it instead leaves a file no player will open.
    capture.stdin.write('q');
    capture.stdin.flush();
    await capture.exited;
  }
  return out;
}

/**
 * Scale a segment into the reel's frame, letterboxed rather than cropped.
 *
 * KOReader runs portrait; the browser is landscape. Cropping to fit would cut
 * the page in half, so the page keeps its shape and the frame takes bars.
 */
export function normalize(input: string, out: string): string {
  run([
    'ffmpeg',
    '-y',
    '-v',
    'error',
    '-i',
    input,
    '-vf',
    `scale=${FRAME.width}:${FRAME.height}:force_original_aspect_ratio=decrease,` +
      `pad=${FRAME.width}:${FRAME.height}:(ow-iw)/2:(oh-ih)/2:color=${BG},fps=15,setsar=1`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-an',
    out,
  ]);
  return out;
}

/** A still, held for a beat — a title card, or air before a cut. */
export function still(image: string, ms: number, out: string): string {
  run([
    'ffmpeg',
    '-y',
    '-v',
    'error',
    '-loop',
    '1',
    '-t',
    (ms / 1000).toFixed(2),
    '-i',
    image,
    '-vf',
    `scale=${FRAME.width}:${FRAME.height}:force_original_aspect_ratio=decrease,` +
      `pad=${FRAME.width}:${FRAME.height}:(ow-iw)/2:(oh-ih)/2:color=${BG},fps=15,setsar=1`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    out,
  ]);
  return out;
}

/**
 * Join the segments and narrate the result.
 *
 * Each segment's lines are shifted by the total length of everything before
 * it, measured from the normalized files rather than assumed — a segment that
 * ran long because a line took longer to speak still lines up.
 */
export function assemble(segments: Segment[], workDir: string, out: string): boolean {
  const normalized: string[] = [];
  const lines: NarrationLine[] = [];
  let offset = 0;

  segments.forEach((segment, i) => {
    const file = path.join(workDir, `seg-${String(i).padStart(2, '0')}.mp4`);
    normalize(segment.video, file);
    normalized.push(file);
    for (const line of segment.lines) lines.push({ ...line, atMs: offset + line.atMs });
    offset += durationMs(file);
  });

  const listFile = path.join(workDir, 'concat.txt');
  writeFileSync(listFile, normalized.map((f) => `file '${f}'`).join('\n'));

  const joined = path.join(workDir, 'joined.mp4');
  run([
    'ffmpeg',
    '-y',
    '-v',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-c',
    'copy',
    joined,
  ]);

  if (!existsSync(joined)) throw new Error('concat produced nothing');
  return mixNarration(joined, lines, out);
}
