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

export function parseReflectionOutput(raw: string, succeeded: boolean): ExtractedReflection {
  try {
    // Try to extract JSON from the output
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackReflection(raw, succeeded);
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      approach: String(parsed.approach ?? 'Unknown approach'),
      whatWorked: parsed.whatWorked ? String(parsed.whatWorked) : null,
      whatFailed: parsed.whatFailed ? String(parsed.whatFailed) : null,
      lesson: String(parsed.lesson ?? 'No lesson extracted'),
      outcome: succeeded ? 'success' : 'failure',
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5))),
    };
  } catch {
    return fallbackReflection(raw, succeeded);
  }
}

function fallbackReflection(raw: string, succeeded: boolean): ExtractedReflection {
  return {
    approach: 'Approach details not available',
    whatWorked: succeeded ? 'Task completed successfully' : null,
    whatFailed: succeeded ? null : 'Task failed',
    lesson: raw.slice(0, 500) || 'No lesson extracted',
    outcome: succeeded ? 'success' : 'failure',
    confidence: 0.3,
  };
}
