/**
 * Renders one page and measures every visible element's box, computed padding,
 * display and text. Playwright is the package's own pinned copy when installed,
 * else designlang's copy; both are the same Chromium stack, never a second
 * browser engine. Failures are values, never throws.
 */
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

export type Viewport = { width: number; height: number };

export type PaddingSides = { top: number; right: number; bottom: number; left: number };

/** A border box in viewport CSS pixels, rounded to two decimals by the script. */
export type ElementBox = { left: number; top: number; right: number; bottom: number };

/** The capture format; a document without it predates versioning and is not current. */
export const LAYOUT_CAPTURE_VERSION = '2';

/** Identity declared through `data-peaks-*`; `props` keys drop the prefix. */
export type LayoutPeaks = {
  object?: string;
  component?: string;
  props?: Record<string, string>;
};

/** One visible element as the injected script measures it. */
export type LayoutElement = {
  /** Index of the nearest visible ancestor in this same array; -1 at the root. */
  parent: number;
  tag: string;
  /** The element's explicit `role` attribute, or null when it declares none. */
  ariaRole: string | null;
  display: string;
  /** Text directly under this element (child text nodes only), whitespace-collapsed. */
  ownText: string;
  /** The subtree's text, whitespace-collapsed and capped; the id's text summary. */
  text: string;
  box: ElementBox;
  padding: PaddingSides;
  /** Computed margin; absent in captures that predate the field. */
  margin?: PaddingSides;
  /** Declared identity markers; absent when the element declares none. */
  peaks?: LayoutPeaks;
  /** A background distinct from the body's own, a visible border, or a shadow. */
  painted: boolean;
};

/** One route at one viewport, as measured. */
export type LayoutGeometry = {
  route: string;
  viewport: Viewport;
  /** Absent in captures that predate versioning, which read as not current. */
  captureVersion?: string;
  elements: LayoutElement[];
};

export type LayoutCaptureResult =
  { ok: true; geometry: LayoutGeometry } | { ok: false; reason: string };

/** One page read twice: the measured elements, and the HTML that produced them. */
export type LayoutPageCapture = { geometry: LayoutGeometry; html: string };

export type LayoutPageResult =
  { ok: true; page: LayoutPageCapture } | { ok: false; reason: string };

type PlaywrightPage = {
  goto(url: string): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
  close(): Promise<void>;
};

export type PlaywrightBrowser = {
  newPage(options: { viewport: Viewport }): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

type PlaywrightModule = {
  chromium: { launch(): Promise<PlaywrightBrowser> };
};

export type LayoutCaptureInput = {
  /** The route this page represents (e.g. `/`); never derived from the URL. */
  route: string;
  url: string;
  viewport: Viewport;
  /** One page action, a CSS selector to click, performed after navigation. */
  click?: string;
  /** Injected by a unit test so no test launches a browser. */
  launch?: () => Promise<PlaywrightBrowser>;
};

/** Subtree text is capped so one huge page cannot bloat the fingerprint input. */
export const LAYOUT_TEXT_CAP = 200;

/** Settle before measuring: webfonts, then one frame; exported for the capture test. */
export const LAYOUT_READY_SCRIPT =
  '(async () => { await document.fonts.ready; await new Promise((done) => ' +
  'requestAnimationFrame(() => done(true))); return true; })()';

/**
 * All elements in document order, each with a parent index into the SAME
 * filtered array. Visibility is filtered by computed display/visibility and a
 * non-zero border box. No selector is hard-coded: the script walks every
 * element, and the cut is decided in TypeScript. Exported so a unit test can
 * parse it: a script string is not type-checked, and a syntax error would
 * otherwise stay invisible until a live page evaluation.
 */
export const LAYOUT_GEOMETRY_SCRIPT = `(() => {
  const collapse = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const round = (value) => Math.round(value * 100) / 100;
  const sides = (style, prefix) => ({
    top: parseFloat(style[prefix + 'Top']) || 0,
    right: parseFloat(style[prefix + 'Right']) || 0,
    bottom: parseFloat(style[prefix + 'Bottom']) || 0,
    left: parseFloat(style[prefix + 'Left']) || 0
  });
  const bodyBackground = getComputedStyle(document.body).backgroundColor;
  const all = Array.from(document.querySelectorAll('*'));
  const visible = [];
  const index = new Map();
  for (const element of all) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (rect.width <= 0 || rect.height <= 0) continue;
    index.set(element, visible.length);
    visible.push({ element, style, rect });
  }
  return visible.map((entry) => {
    const element = entry.element;
    const style = entry.style;
    const rect = entry.rect;
    let ancestor = element.parentElement;
    let parent = -1;
    while (ancestor) {
      const found = index.get(ancestor);
      if (found !== undefined) { parent = found; break; }
      ancestor = ancestor.parentElement;
    }
    const ownText = collapse(
      Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent)
        .join(' ')
    );
    const background = style.backgroundColor;
    const paintedBackground =
      background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent' && background !== bodyBackground;
    const border = ['Top', 'Right', 'Bottom', 'Left'].some(
      (side) =>
        parseFloat(style['border' + side + 'Width']) > 0 && style['border' + side + 'Style'] !== 'none'
    );
    const props = {};
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith('data-peaks-prop-')) {
        props[attribute.name.slice('data-peaks-prop-'.length)] = attribute.value;
      }
    }
    const peaks = {};
    const objectName = element.getAttribute('data-peaks-object');
    const componentName = element.getAttribute('data-peaks-component');
    if (objectName !== null) peaks.object = objectName;
    if (componentName !== null) peaks.component = componentName;
    if (Object.keys(props).length > 0) peaks.props = props;
    return {
      parent,
      tag: element.tagName.toLowerCase(),
      ariaRole: element.getAttribute('role'),
      display: style.display,
      ownText,
      text: collapse(element.textContent).slice(0, ${String(LAYOUT_TEXT_CAP)}),
      box: {
        left: round(rect.left),
        top: round(rect.top),
        right: round(rect.right),
        bottom: round(rect.bottom)
      },
      padding: sides(style, 'padding'),
      margin: sides(style, 'margin'),
      ...(Object.keys(peaks).length > 0 ? { peaks } : {}),
      painted: paintedBackground || border || style.boxShadow !== 'none'
    };
  });
})()`;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Closing is hygiene, never evidence: a close failure cannot change the result. */
async function closeQuietly(close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch {
    return;
  }
}

/**
 * Resolve Playwright from the package's own install when it is there (a pinned
 * devDependency the CI browser step installs), otherwise from designlang's
 * install, which is what a consumer's tree has. Both paths reach the same
 * deduped copy in this repository; the fallback keeps a consumer working.
 */
function resolvePlaywright(): PlaywrightModule {
  const require = createRequire(import.meta.url);
  try {
    const direct: unknown = require(require.resolve('playwright'));
    return direct as PlaywrightModule;
  } catch {
    const designlangEntry = require.resolve('designlang');
    const playwrightEntry = require.resolve('playwright', { paths: [dirname(designlangEntry)] });
    const fallback: unknown = require(playwrightEntry);
    return fallback as PlaywrightModule;
  }
}

async function launchBrowser(): Promise<PlaywrightBrowser> {
  return resolvePlaywright().chromium.launch();
}

/** The rendered document that the measured elements were cut from. */
export const LAYOUT_HTML_SCRIPT = 'document.documentElement.outerHTML';

async function capturePage(
  input: LayoutCaptureInput,
  withHtml: boolean
): Promise<LayoutPageResult> {
  let browser: PlaywrightBrowser;
  try {
    browser = await (input.launch ?? launchBrowser)();
  } catch (error) {
    return {
      ok: false,
      reason: `the layout capture browser could not launch (${errorText(error)})`
    };
  }
  try {
    const page = await browser.newPage({ viewport: input.viewport });
    try {
      await page.goto(input.url);
      if (input.click !== undefined) {
        const selector = JSON.stringify(input.click);
        const clicked = await page.evaluate<boolean>(
          `(() => { const target = document.querySelector(${selector}); ` +
            'if (target === null) return false; target.click(); return true; })()'
        );
        if (!clicked) {
          return { ok: false, reason: `the declared action found no element for ${input.click}` };
        }
      }
      await page.evaluate<boolean>(LAYOUT_READY_SCRIPT);
      const elements = await page.evaluate<LayoutElement[]>(LAYOUT_GEOMETRY_SCRIPT);
      const html = withHtml ? await page.evaluate<string>(LAYOUT_HTML_SCRIPT) : '';
      const geometry: LayoutGeometry = {
        route: input.route,
        viewport: input.viewport,
        captureVersion: LAYOUT_CAPTURE_VERSION,
        elements
      };
      return { ok: true, page: { geometry, html } };
    } finally {
      await closeQuietly(() => page.close());
    }
  } catch (error) {
    return {
      ok: false,
      reason: `the layout capture could not read ${input.url} (${errorText(error)})`
    };
  } finally {
    await closeQuietly(() => browser.close());
  }
}

/**
 * Open one page at one viewport and return the measured elements. The browser
 * is always closed, including when navigation or the evaluation fails; a closed
 * page failure is folded into the same value.
 */
export async function captureLayoutGeometry(
  input: LayoutCaptureInput
): Promise<LayoutCaptureResult> {
  const result = await capturePage(input, false);
  return result.ok ? { ok: true, geometry: result.page.geometry } : result;
}

/** The same capture, additionally returning the rendered HTML of the page. */
export async function captureLayoutPage(input: LayoutCaptureInput): Promise<LayoutPageResult> {
  return capturePage(input, true);
}
