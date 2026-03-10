import type { AdapterContext, ToolDefinition } from '@clawgear/shared/interfaces';

export interface AssembleContextInput {
  agentId: string;
  companyId: string;
  systemPrompt: string | null;
  taskDescription: string | null;
  sessionId: string | null;
  timeout: number;
  tools?: ToolDefinition[];
  adapterConfig?: Record<string, unknown>;
  // Rich context fields (Sub-Phase 2B)
  agentName?: string;
  agentRole?: string;
  goalHierarchy?: string[];
  competenceSummary?: string;
  lessons?: string[];
  maxTokenEstimate?: number;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;
const TOKEN_BUDGET_RATIO = 0.8;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function assembleContext(input: AssembleContextInput): AdapterContext {
  const maxTokens = input.maxTokenEstimate ?? DEFAULT_CONTEXT_WINDOW;
  const tokenBudget = Math.floor(maxTokens * TOKEN_BUDGET_RATIO);
  let usedTokens = 0;

  const blocks: string[] = [];

  // Identity block
  const identity = input.agentName
    ? `You are ${input.agentName}, a ${input.agentRole ?? 'agent'} agent.`
    : (input.systemPrompt ?? 'You are a helpful AI agent.');
  blocks.push(identity);
  usedTokens += estimateTokens(identity);

  // System prompt (if identity was built from name/role and system prompt is separate)
  if (input.agentName && input.systemPrompt) {
    const sysBlock = `## Instructions\n${input.systemPrompt}`;
    const sysTokens = estimateTokens(sysBlock);
    if (usedTokens + sysTokens < tokenBudget) {
      blocks.push(sysBlock);
      usedTokens += sysTokens;
    }
  }

  // Goal hierarchy
  if (input.goalHierarchy && input.goalHierarchy.length > 0) {
    const goalBlock = `## Goal Hierarchy\n${input.goalHierarchy.map((g, i) => `${'  '.repeat(i)}${i + 1}. ${g}`).join('\n')}`;
    const goalTokens = estimateTokens(goalBlock);
    if (usedTokens + goalTokens < tokenBudget) {
      blocks.push(goalBlock);
      usedTokens += goalTokens;
    }
  }

  // Competence summary
  if (input.competenceSummary) {
    const compBlock = `## Your Track Record\n${input.competenceSummary}`;
    const compTokens = estimateTokens(compBlock);
    if (usedTokens + compTokens < tokenBudget) {
      blocks.push(compBlock);
      usedTokens += compTokens;
    }
  }

  // Lessons learned
  if (input.lessons && input.lessons.length > 0) {
    const lessonsBlock = `## Lessons Learned\nHere's what the team has learned from past work:\n${input.lessons.map((l) => `- ${l}`).join('\n')}`;
    const lessonsTokens = estimateTokens(lessonsBlock);
    if (usedTokens + lessonsTokens < tokenBudget) {
      blocks.push(lessonsBlock);
      usedTokens += lessonsTokens;
    }
  }

  // Current task
  const task = input.taskDescription ?? 'No task currently assigned.';
  const taskBlock = `## Current Task\n${task}`;
  blocks.push(taskBlock);

  // Tool manifest
  if (input.tools && input.tools.length > 0) {
    const toolBlock = `## Available Tools\n${input.tools.map((t) => `- **${t.name}**: ${t.description}`).join('\n')}`;
    const toolTokens = estimateTokens(toolBlock);
    if (usedTokens + toolTokens < tokenBudget) {
      blocks.push(toolBlock);
    }
  }

  const systemPrompt = blocks.join('\n\n');

  return {
    agentId: input.agentId,
    companyId: input.companyId,
    systemPrompt,
    taskPrompt: task,
    tools: input.tools ?? [],
    sessionId: input.sessionId,
    timeout: input.timeout,
    adapterConfig: input.adapterConfig,
  };
}
