import { expect, test } from 'bun:test';
import { APP_NAME } from './meta.ts';

test('harness runs', () => {
  expect(APP_NAME).toBe('reader-42');
});
