import { validateUrl } from '@clawgear/security';
import type { BrowserContext, Page } from 'playwright';
import type {
  BrowserSessionConfig,
  BrowserToolResult,
  EvaluateResult,
  ExtractResult,
  NavigationResult,
  ScreenshotResult,
} from './types.js';

export class BrowserSession {
  private context: BrowserContext;
  private page: Page | null = null;
  private closed = false;
  private config: Required<BrowserSessionConfig>;

  constructor(context: BrowserContext, config: Required<BrowserSessionConfig>) {
    this.context = context;
    this.config = config;
  }

  /** Check if this session has been closed. */
  isClosed(): boolean {
    return this.closed;
  }

  /** Get or create the active page. */
  private async getPage(): Promise<Page> {
    if (this.closed) throw new Error('Session is closed');
    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(this.config.navigationTimeout);
    }
    return this.page;
  }

  /** Validate a URL against SSRF rules and agent allowlist. */
  private validateNavigation(url: string): BrowserToolResult {
    const check = validateUrl(url, this.config.urlAllowlist);
    if (!check.allowed) {
      return { success: false, error: `Navigation blocked: ${check.reason}` };
    }
    return { success: true };
  }

  /** Navigate to a URL. */
  async navigate(url: string): Promise<BrowserToolResult> {
    const validation = this.validateNavigation(url);
    if (!validation.success) return validation;

    try {
      const page = await this.getPage();
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.navigationTimeout,
      });
      const title = await page.title();
      const result: NavigationResult = {
        url: page.url(),
        status: response?.status() ?? 0,
        title,
      };
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: `Navigation failed: ${String(err)}` };
    }
  }

  /** Click an element matching a CSS selector. */
  async click(selector: string): Promise<BrowserToolResult> {
    try {
      const page = await this.getPage();
      await page.click(selector, { timeout: this.config.navigationTimeout });
      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: `Click failed: ${String(err)}` };
    }
  }

  /** Type text into an element matching a CSS selector. */
  async type(selector: string, text: string): Promise<BrowserToolResult> {
    try {
      const page = await this.getPage();
      await page.fill(selector, text, { timeout: this.config.navigationTimeout });
      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: `Type failed: ${String(err)}` };
    }
  }

  /** Take a screenshot of the current page. */
  async screenshot(fullPage = false): Promise<BrowserToolResult> {
    try {
      const page = await this.getPage();
      const buffer = await page.screenshot({ fullPage, type: 'png' });
      const viewport = page.viewportSize();
      const result: ScreenshotResult = {
        data: buffer.toString('base64'),
        width: viewport?.width ?? 0,
        height: viewport?.height ?? 0,
      };
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: `Screenshot failed: ${String(err)}` };
    }
  }

  /** Extract text content from the page or a specific element. */
  async extractText(selector?: string): Promise<BrowserToolResult> {
    try {
      const page = await this.getPage();
      let text: string;
      if (selector) {
        text = (await page.textContent(selector, { timeout: this.config.navigationTimeout })) ?? '';
      } else {
        text = await page.innerText('body');
      }
      const result: ExtractResult = { text: text.trim(), selector: selector ?? null };
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: `Extract failed: ${String(err)}` };
    }
  }

  /** Wait for an element to appear in the DOM. */
  async waitFor(selector: string, timeout?: number): Promise<BrowserToolResult> {
    try {
      const page = await this.getPage();
      await page.waitForSelector(selector, {
        timeout: timeout ?? this.config.navigationTimeout,
        state: 'visible',
      });
      return { success: true, data: null };
    } catch (err) {
      return { success: false, error: `Wait failed: ${String(err)}` };
    }
  }

  /** Evaluate JavaScript in the page context. */
  async evaluate(script: string): Promise<BrowserToolResult> {
    try {
      const page = await this.getPage();
      const value = await page.evaluate(script);
      const result: EvaluateResult = { value };
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: `Evaluate failed: ${String(err)}` };
    }
  }

  /** Get the current page URL. */
  async currentUrl(): Promise<string> {
    const page = await this.getPage();
    return page.url();
  }

  /** Close this session's page (context stays open for reuse). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.page && !this.page.isClosed()) {
      await this.page.close();
    }
    this.page = null;
  }
}
