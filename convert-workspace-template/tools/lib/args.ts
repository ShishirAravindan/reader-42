/**
 * Tiny CLI argument parser for tool scripts. Zero-dependency.
 *
 * Supports `--key=value` and `--flag` forms, plus positional arguments. We
 * deliberately avoid a full parser library — the toolbox is meant to stay
 * dependency-free.
 */

export interface ParsedArgs {
  flags: Record<string, string | true>;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq === -1) {
        flags[body] = true;
      } else {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

export function getString(args: ParsedArgs, key: string, fallback?: string): string | undefined {
  const v = args.flags[key];
  if (v === undefined || v === true) return fallback;
  return v;
}

export function hasFlag(args: ParsedArgs, key: string): boolean {
  return args.flags[key] !== undefined;
}
