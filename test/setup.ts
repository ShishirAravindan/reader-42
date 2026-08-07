// Test preload: a jsdom-backed DOM so parser, renderer, and controller code
// runs under bun test. jsdom does no layout — geometry-dependent behavior is
// covered by the demo scenes, not unit tests. Dev-only; the real runtime is
// the browser.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

const g = globalThis as Record<string, unknown>;
g.DOMParser = dom.window.DOMParser;
g.document = dom.window.document;
g.window = dom.window;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLAnchorElement = dom.window.HTMLAnchorElement;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
g.TouchEvent = dom.window.TouchEvent;
g.ShadowRoot = dom.window.ShadowRoot;
g.MouseEvent = dom.window.MouseEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.localStorage = dom.window.localStorage;
