import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { BrowserPool } from './browser-pool.js';
import { BrowserSession } from './browser-session.js';
import { BROWSER_TOOLS, executeBrowserTool } from './browser-tools.js';
import { CdpRelay } from './cdp-relay.js';

// ---------------------------------------------------------------------------
// Mock Playwright so tests don't need a real browser
// ---------------------------------------------------------------------------
const mockPage = {
  goto: mock(() => Promise.resolve({ status: () => 200 })),
  title: mock(() => Promise.resolve('Test Page')),
  url: mock(() => 'https://example.com'),
  click: mock(() => Promise.resolve()),
  fill: mock(() => Promise.resolve()),
  screenshot: mock(() => Promise.resolve(Buffer.from('fake-png'))),
  textContent: mock(() => Promise.resolve('Hello World')),
  innerText: mock(() => Promise.resolve('Full page text')),
  waitForSelector: mock(() => Promise.resolve()),
  evaluate: mock(() => Promise.resolve(42)),
  viewportSize: mock(() => ({ width: 1280, height: 720 })),
  isClosed: mock(() => false),
  close: mock(() => Promise.resolve()),
  setDefaultTimeout: mock(() => {}),
};

const mockContext = {
  newPage: mock(() => Promise.resolve(mockPage)),
  close: mock(() => Promise.resolve()),
};

const mockBrowser = {
  newContext: mock(() => Promise.resolve(mockContext)),
  close: mock(() => Promise.resolve()),
  isConnected: mock(() => true),
  contexts: mock(() => [mockContext]),
};

// Mock Playwright chromium
mock.module('playwright', () => ({
  chromium: {
    launch: mock(() => Promise.resolve(mockBrowser)),
    connectOverCDP: mock(() => Promise.resolve(mockBrowser)),
  },
}));

// ---------------------------------------------------------------------------
// BrowserPool tests
// ---------------------------------------------------------------------------
describe('BrowserPool', () => {
  let pool: BrowserPool;

  beforeEach(() => {
    pool = new BrowserPool({ maxBrowsers: 3, headless: true });
  });

  afterAll(async () => {
    await pool.shutdown();
  });

  it('should acquire a session for an agent', async () => {
    const session = await pool.acquire({
      agentId: 'agent-1',
      companyId: 'company-1',
      urlAllowlist: ['*.example.com'],
    });
    expect(session).toBeInstanceOf(BrowserSession);
    expect(pool.activeSessions()).toContain('agent-1');
  });

  it('should reuse existing session for same agent', async () => {
    const session1 = await pool.acquire({
      agentId: 'agent-2',
      companyId: 'company-1',
      urlAllowlist: ['*.example.com'],
    });
    const session2 = await pool.acquire({
      agentId: 'agent-2',
      companyId: 'company-1',
      urlAllowlist: ['*.example.com'],
    });
    expect(session1).toBe(session2);
  });

  it('should release an agent session', async () => {
    await pool.acquire({
      agentId: 'agent-3',
      companyId: 'company-1',
      urlAllowlist: [],
    });
    expect(pool.activeSessions()).toContain('agent-3');
    await pool.release('agent-3');
    expect(pool.activeSessions()).not.toContain('agent-3');
  });

  it('should report stats', async () => {
    await pool.acquire({
      agentId: 'agent-4',
      companyId: 'company-1',
      urlAllowlist: [],
    });
    const stats = pool.stats();
    expect(stats.activeSessions).toBeGreaterThanOrEqual(1);
    expect(stats.maxBrowsers).toBe(3);
    expect(stats.isRunning).toBe(true);
  });

  it('should refuse acquisition after shutdown', async () => {
    const p = new BrowserPool();
    await p.shutdown();
    expect(p.acquire({ agentId: 'agent-x', companyId: 'c-1', urlAllowlist: [] })).rejects.toThrow(
      'shutting down',
    );
  });
});

// ---------------------------------------------------------------------------
// BrowserSession tests
// ---------------------------------------------------------------------------
describe('BrowserSession', () => {
  let session: BrowserSession;

  beforeEach(() => {
    // Reset mocks
    mockPage.goto.mockImplementation(() => Promise.resolve({ status: () => 200 }));
    mockPage.title.mockImplementation(() => Promise.resolve('Test Page'));
    mockPage.url.mockImplementation(() => 'https://example.com');

    // Create session with a real-looking config
    session = new BrowserSession(mockContext as never, {
      agentId: 'agent-1',
      companyId: 'company-1',
      urlAllowlist: ['*.example.com', 'docs.github.com'],
      navigationTimeout: 30_000,
      jsExecutionTimeout: 10_000,
    });
  });

  it('should navigate to an allowed URL', async () => {
    const result = await session.navigate('https://example.com/page');
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should block navigation to private IPs (SSRF)', async () => {
    const result = await session.navigate('http://192.168.1.1/admin');
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
  });

  it('should block navigation to metadata endpoints', async () => {
    const result = await session.navigate('http://169.254.169.254/latest/meta-data/');
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
  });

  it('should block non-allowlisted URLs when allowlist is set', async () => {
    const result = await session.navigate('https://evil.com/phish');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not in allowlist');
  });

  it('should take a screenshot', async () => {
    // Navigate first to get a page
    await session.navigate('https://example.com');
    const result = await session.screenshot();
    expect(result.success).toBe(true);
  });

  it('should extract text', async () => {
    await session.navigate('https://example.com');
    const result = await session.extractText();
    expect(result.success).toBe(true);
  });

  it('should click elements', async () => {
    await session.navigate('https://example.com');
    const result = await session.click('button.submit');
    expect(result.success).toBe(true);
  });

  it('should type into elements', async () => {
    await session.navigate('https://example.com');
    const result = await session.type('input#search', 'hello');
    expect(result.success).toBe(true);
  });

  it('should evaluate JavaScript', async () => {
    await session.navigate('https://example.com');
    const result = await session.evaluate('1 + 1');
    expect(result.success).toBe(true);
  });

  it('should report closed state after close', async () => {
    expect(session.isClosed()).toBe(false);
    await session.close();
    expect(session.isClosed()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CdpRelay tests
// ---------------------------------------------------------------------------
describe('CdpRelay', () => {
  it('should connect and create a session', async () => {
    const relay = new CdpRelay({ cdpEndpoint: 'ws://localhost:9222' });
    await relay.connect();
    expect(relay.isConnected()).toBe(true);

    const session = await relay.createSession({
      agentId: 'agent-cdp-1',
      companyId: 'company-1',
      urlAllowlist: ['*.example.com'],
    });
    expect(session).toBeInstanceOf(BrowserSession);

    await relay.disconnect();
  });

  it('should throw if creating session before connecting', async () => {
    const relay = new CdpRelay({ cdpEndpoint: 'ws://localhost:9222' });
    expect(
      relay.createSession({
        agentId: 'agent-cdp-2',
        companyId: 'company-1',
        urlAllowlist: [],
      }),
    ).rejects.toThrow('not connected');
  });
});

// ---------------------------------------------------------------------------
// Browser tools tests
// ---------------------------------------------------------------------------
describe('BrowserTools', () => {
  it('should have all expected tool definitions', () => {
    const toolNames = BROWSER_TOOLS.map((t) => t.name);
    expect(toolNames).toContain('browser_navigate');
    expect(toolNames).toContain('browser_click');
    expect(toolNames).toContain('browser_type');
    expect(toolNames).toContain('browser_screenshot');
    expect(toolNames).toContain('browser_extract_text');
    expect(toolNames).toContain('browser_wait_for');
    expect(toolNames).toContain('browser_evaluate');
    expect(toolNames).toContain('browser_current_url');
    expect(toolNames).toHaveLength(8);
  });

  it('should execute browser_navigate tool', async () => {
    const session = new BrowserSession(mockContext as never, {
      agentId: 'agent-tool-1',
      companyId: 'company-1',
      urlAllowlist: ['*.example.com'],
      navigationTimeout: 30_000,
      jsExecutionTimeout: 10_000,
    });
    const result = await executeBrowserTool(session, 'browser_navigate', {
      url: 'https://example.com',
    });
    expect(result.success).toBe(true);
  });

  it('should return error for unknown tool', async () => {
    const session = new BrowserSession(mockContext as never, {
      agentId: 'agent-tool-2',
      companyId: 'company-1',
      urlAllowlist: [],
      navigationTimeout: 30_000,
      jsExecutionTimeout: 10_000,
    });
    const result = await executeBrowserTool(session, 'browser_nonexistent', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown browser tool');
  });
});
