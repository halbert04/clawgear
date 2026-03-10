import type { Capability } from '@clawgear/shared/types';

/**
 * Maps a tool name + args to the required capability.
 * Returns null if the tool requires no special capability (e.g. report_progress).
 */
export function mapToolToCapability(
  tool: string,
  args: Record<string, unknown>,
): Capability | null {
  switch (tool) {
    case 'checkout_issue':
    case 'update_issue_status':
    case 'add_comment':
    case 'create_sub_issue':
    case 'complete_task':
      return { type: 'tool_invoke', toolId: tool };

    case 'memory_store':
    case 'memory_retrieve':
    case 'fact_store':
    case 'fact_query':
      return { type: 'tool_invoke', toolId: tool };

    case 'message_agent':
      return { type: 'agent_message', agentId: (args.toAgentId as string) ?? '*' };

    case 'report_progress':
      // Always allowed — no capability gate
      return null;

    default:
      // Unknown tools require explicit tool_invoke capability
      return { type: 'tool_invoke', toolId: tool };
  }
}

/**
 * Checks whether a single held capability satisfies a required capability.
 */
export function satisfiesCapability(held: Capability, required: Capability): boolean {
  if (held.type !== required.type) return false;

  switch (held.type) {
    case 'tool_invoke':
      // Wildcard '*' grants all tools
      return held.toolId === '*' || held.toolId === (required as typeof held).toolId;

    case 'agent_message':
      return held.agentId === '*' || held.agentId === (required as typeof held).agentId;

    case 'file_read':
      return matchGlob(held.glob, (required as typeof held).glob);

    case 'file_write':
      return matchGlob(held.glob, (required as typeof held).glob);

    case 'net_connect':
      return matchPattern(held.pattern, (required as typeof held).pattern);

    case 'shell_exec': {
      const reqCommands = (required as typeof held).commands;
      return reqCommands.every((cmd) => held.commands.includes(cmd));
    }

    case 'docker_exec':
      return held.image === '*' || held.image === (required as typeof held).image;

    default:
      return false;
  }
}

/**
 * Checks whether any of the agent's capabilities satisfy the required one.
 */
export function hasCapability(capabilities: Capability[], required: Capability): boolean {
  return capabilities.some((cap) => satisfiesCapability(cap, required));
}

/**
 * Simple glob matching: supports '*' as a wildcard segment.
 * e.g. '*.ts' matches 'foo.ts', '/src/**' matches '/src/bar/baz'.
 */
function matchGlob(pattern: string, target: string): boolean {
  if (pattern === '*' || pattern === '**') return true;
  if (pattern === target) return true;

  // Convert glob to regex
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = `^${escaped.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`;
  try {
    return new RegExp(regexStr).test(target);
  } catch {
    return pattern === target;
  }
}

/**
 * Pattern matching for net_connect: supports wildcard prefix.
 * e.g. '*.github.com' matches 'api.github.com'.
 */
function matchPattern(pattern: string, target: string): boolean {
  if (pattern === '*') return true;
  if (pattern === target) return true;

  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // '.github.com'
    return target.endsWith(suffix) || target === pattern.slice(2);
  }

  return false;
}
