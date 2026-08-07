// The acceptance suite's own gate. Everything geometry-dependent in this
// reader is proven only by the scenes, so the one failure mode that cannot be
// tolerated is a suite that passes because it ran nothing.

import { describe, expect, it } from 'bun:test';
import { assertScenesRegistered } from './harness.ts';

describe('assertScenesRegistered', () => {
  it('rejects an empty registry instead of passing zero scenes', () => {
    // The regression: a run loop over an empty array prints "all 0 scenes
    // passed" and exits 0. Losing the side-effect import that registers the
    // scenes must turn CI red, not green.
    expect(() => assertScenesRegistered(0)).toThrow(/no scenes registered/);
  });

  it('names the cause, so a red build points at the missing import', () => {
    expect(() => assertScenesRegistered(0)).toThrow(/run\.ts/);
  });

  it('passes a registry with scenes in it', () => {
    expect(() => assertScenesRegistered(1)).not.toThrow();
    expect(() => assertScenesRegistered(17)).not.toThrow();
  });
});
