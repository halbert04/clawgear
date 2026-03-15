import type { LessonOutcome } from '@clawgear/shared/constants';

export interface ReflectionInput {
  agentId: string;
  companyId: string;
  runId: string;
  issueId?: string;
  taskType: string;
  adapterOutput: string;
  succeeded: boolean;
  toolCalls: { tool: string; args: Record<string, unknown>; result: unknown }[];
}

export interface ExtractedReflection {
  approach: string;
  whatWorked: string | null;
  whatFailed: string | null;
  lesson: string;
  outcome: LessonOutcome;
  confidence: number;
}

export function buildReflectionPrompt(input: ReflectionInput): string {
  const toolSummary =
    input.toolCalls.length > 0
      ? `Tools used: ${input.toolCalls.map((t) => t.tool).join(', ')}`
      : 'No tools were used.';

  return `You just completed a task. Reflect on what happened and extract a lesson.

## Context
- Task type: ${input.taskType}
- Outcome: ${input.succeeded ? 'succeeded' : 'failed'}
- ${toolSummary}

## Your Output
${input.adapterOutput.slice(0, 2000)}

## Instructions
Respond in JSON with exactly these fields:
{
  "approach": "Brief description of the approach taken",
  "whatWorked": "What worked well (or null)",
  "whatFailed": "What went wrong (or null)",
  "lesson": "A concise lesson for future similar tasks",
  "confidence": 0.0 to 1.0
}`;
}

export function parseReflectionOutput(
  raw: string,
  succeeded: boolean,
  toolCalls?: { tool: string }[],
): ExtractedReflection {
  try {
    // Try to extract JSON from the output — only match if it looks like a reflection block
    const jsonMatch = raw.match(/\{[\s\S]*"(?:approach|lesson)"[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackReflection(raw, succeeded, toolCalls);
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    // Validate it actually has the fields we expect
    if (!parsed.approach && !parsed.lesson) {
      return fallbackReflection(raw, succeeded, toolCalls);
    }

    return {
      approach: String(parsed.approach ?? 'Unknown approach'),
      whatWorked: parsed.whatWorked ? String(parsed.whatWorked) : null,
      whatFailed: parsed.whatFailed ? String(parsed.whatFailed) : null,
      lesson: String(parsed.lesson ?? 'No lesson extracted'),
      outcome: succeeded ? 'success' : 'failure',
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5))),
    };
  } catch {
    return fallbackReflection(raw, succeeded, toolCalls);
  }
}

function fallbackReflection(
  raw: string,
  succeeded: boolean,
  toolCalls?: { tool: string }[],
): ExtractedReflection {
  // Extract meaningful information from natural language output
  const sentences = raw
    .split(/[.!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  // Build approach from tool calls if available
  const approach =
    toolCalls && toolCalls.length > 0
      ? `Used tools: ${[...new Set(toolCalls.map((t) => t.tool))].join(', ')}`
      : sentences[0] ?? 'Approach details not available';

  // First substantive sentence is the lesson — better than raw truncation
  const lesson =
    sentences.find((s) => s.length > 20) ?? (raw.slice(0, 500) || 'No lesson extracted');

  return {
    approach,
    whatWorked: succeeded ? (sentences[1] ?? 'Task completed successfully') : null,
    whatFailed: succeeded ? null : (sentences.find((s) => /fail|error|issue|problem/i.test(s)) ?? 'Task failed'),
    lesson,
    outcome: succeeded ? 'success' : 'failure',
    confidence: sentences.length > 0 ? 0.5 : 0.2,
  };
}
