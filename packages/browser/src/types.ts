export interface BrowserPoolConfig {
  /** Maximum number of concurrent browser instances */
  maxBrowsers: number;
  /** Maximum pages per browser context */
  maxPagesPerContext: number;
  /** Navigation timeout in ms */
  navigationTimeout: number;
  /** JavaScript execution timeout in ms */
  jsExecutionTimeout: number;
  /** Launch browsers in headless mode */
  headless: boolean;
  /** Optional proxy server URL */
  proxy?: string;
  /** Custom user agent string */
  userAgent?: string;
}

export const DEFAULT_POOL_CONFIG: BrowserPoolConfig = {
  maxBrowsers: 5,
  maxPagesPerContext: 10,
  navigationTimeout: 30_000,
  jsExecutionTimeout: 10_000,
  headless: true,
};

export interface BrowserSessionConfig {
  agentId: string;
  companyId: string;
  /** URL allowlist for SSRF protection. Empty = block all. */
  urlAllowlist: string[];
  navigationTimeout?: number;
  jsExecutionTimeout?: number;
}

export interface NavigationResult {
  url: string;
  status: number;
  title: string;
}

export interface ScreenshotResult {
  /** Base64 encoded PNG */
  data: string;
  width: number;
  height: number;
}

export interface ExtractResult {
  text: string;
  selector: string | null;
}

export interface EvaluateResult {
  value: unknown;
}

export interface BrowserToolResult {
  success: boolean;
  error?: string;
  data?: NavigationResult | ScreenshotResult | ExtractResult | EvaluateResult | null;
}
