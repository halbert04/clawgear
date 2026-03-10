import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HandConfig } from '@clawgear/shared/types';
import { handConfigSchema } from '@clawgear/shared/validators';
import { parse as parseToml } from 'smol-toml';

export function parseHandToml(tomlString: string): HandConfig {
  const raw = parseToml(tomlString);

  // Flatten TOML sections into a single config object
  const flat: Record<string, unknown> = {};

  // Top-level fields
  if (raw.hand && typeof raw.hand === 'object') {
    const hand = raw.hand as Record<string, unknown>;
    flat.name = hand.name;
    flat.description = hand.description;
    flat.schedule = hand.schedule;
    flat.taskPrompt = hand.task_prompt ?? hand.taskPrompt;
    flat.requiresApproval = hand.requires_approval ?? hand.requiresApproval ?? false;
    flat.outputMode = hand.output_mode ?? hand.outputMode ?? 'comment';
    flat.ownerAgentId = hand.owner_agent_id ?? hand.ownerAgentId ?? null;
  }

  // Adapter section
  if (raw.adapter && typeof raw.adapter === 'object') {
    const adapter = raw.adapter as Record<string, unknown>;
    flat.innerAdapter = adapter.type ?? adapter.innerAdapter ?? 'claude_code';
    flat.innerAdapterConfig = adapter.config ?? adapter.innerAdapterConfig ?? {};
  } else {
    flat.innerAdapter = flat.innerAdapter ?? 'claude_code';
    flat.innerAdapterConfig = flat.innerAdapterConfig ?? {};
  }

  // Tools, settings, metrics arrays
  flat.tools = raw.tools ?? [];
  flat.settings = raw.settings ?? {};
  flat.metrics = raw.metrics ?? [];

  // Handle metrics as array of strings if it's a TOML table with track key
  if (raw.metrics && typeof raw.metrics === 'object' && !Array.isArray(raw.metrics)) {
    const metricsObj = raw.metrics as Record<string, unknown>;
    flat.metrics = metricsObj.track ?? [];
  }

  return handConfigSchema.parse(flat);
}

export interface HandTemplate {
  config: HandConfig;
  systemPrompt: string;
}

export async function loadHandTemplate(handName: string, handsDir: string): Promise<HandTemplate> {
  const handDir = join(handsDir, handName);

  const tomlPath = join(handDir, 'HAND.toml');
  const promptPath = join(handDir, 'system-prompt.md');

  const tomlContent = await readFile(tomlPath, 'utf-8');
  const config = parseHandToml(tomlContent);

  let systemPrompt = '';
  try {
    systemPrompt = await readFile(promptPath, 'utf-8');
  } catch {
    // system-prompt.md is optional
  }

  return { config, systemPrompt };
}
