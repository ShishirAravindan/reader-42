// Entry point: registers the scenes, then runs them. `bun run demo`
// (optionally --video to record, --headed to watch).

import './scenes.ts';
import { runScenes } from './harness.ts';

await runScenes();
