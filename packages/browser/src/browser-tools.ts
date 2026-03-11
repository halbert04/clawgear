import type { BrowserSession } from './browser-session.js';
import type { BrowserToolResult } from './types.js';

export interface BrowserToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

/** Registry of all browser tools available to agents. */
export const BROWSER_TOOLS: BrowserToolDefinition[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL in the browser. URL is validated against SSRF rules.',
    parameters: {
      url: { type: 'string', description: 'The URL to navigate to', required: true },
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page by CSS selector.',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector for the element to click',
        required: true,
      },
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input element on the page.',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector for the input element',
        required: true,
      },
      text: { type: 'string', description: 'Text to type into the element', required: true },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page. Returns base64 PNG.',
    parameters: {
      fullPage: { type: 'boolean', description: 'Capture full scrollable page', required: false },
    },
  },
  {
    name: 'browser_extract_text',
    description: 'Extract text content from the page or a specific element.',
    parameters: {
      selector: {
        type: 'string',
        description: 'CSS selector to extract text from. Omit for full page body text.',
        required: false,
      },
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait for an element to appear on the page.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to wait for', required: true },
      timeout: { type: 'number', description: 'Timeout in milliseconds', required: false },
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Execute JavaScript in the page context and return the result.',
    parameters: {
      script: { type: 'string', description: 'JavaScript code to evaluate', required: true },
    },
  },
  {
    name: 'browser_current_url',
    description: 'Get the current page URL.',
    parameters: {},
  },
];

/**
 * Execute a browser tool by name with the given arguments.
 */
export async function executeBrowserTool(
  session: BrowserSession,
  toolName: string,
  args: Record<string, unknown>,
): Promise<BrowserToolResult> {
  switch (toolName) {
    case 'browser_navigate':
      return session.navigate(args.url as string);

    case 'browser_click':
      return session.click(args.selector as string);

    case 'browser_type':
      return session.type(args.selector as string, args.text as string);

    case 'browser_screenshot':
      return session.screenshot(args.fullPage as boolean | undefined);

    case 'browser_extract_text':
      return session.extractText(args.selector as string | undefined);

    case 'browser_wait_for':
      return session.waitFor(args.selector as string, args.timeout as number | undefined);

    case 'browser_evaluate':
      return session.evaluate(args.script as string);

    case 'browser_current_url': {
      try {
        const url = await session.currentUrl();
        return { success: true, data: { url, status: 0, title: '' } };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }

    default:
      return { success: false, error: `Unknown browser tool: ${toolName}` };
  }
}
