// Test preload: exposes DOMParser (via jsdom) so the EPUB parser's XML
// handling works under bun test. Dev-only; the real runtime is the browser.
import { JSDOM } from 'jsdom';

const dom = new JSDOM();
(globalThis as { DOMParser?: unknown }).DOMParser = dom.window.DOMParser;
