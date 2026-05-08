import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '../../../../');

export const TEMPLATE_DIR = path.join(repoRoot, 'convert-workspace-template');
