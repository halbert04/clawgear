import { describe, expect, it } from 'bun:test';
import { parseHandToml } from './hand-config-parser.js';

const VALID_TOML = `
[hand]
name = "researcher"
description = "Deep research hand using CRAAP methodology"
schedule = "0 */6 * * *"
task_prompt = "Conduct deep research on assigned topics."
requires_approval = false
output_mode = "comment"

[adapter]
type = "claude_code"

[adapter.config]
timeout = 300

[settings]
methodology = "CRAAP"
max_sources = 5

[metrics]
track = ["sources_evaluated", "facts_discovered"]
`;

const MINIMAL_TOML = `
[hand]
name = "minimal"
description = "Minimal hand"
schedule = "* * * * *"
task_prompt = "Do something"

[adapter]
type = "process"
`;

describe('parseHandToml', () => {
  it('parses a valid HAND.toml with all sections', () => {
    const config = parseHandToml(VALID_TOML);

    expect(config.name).toBe('researcher');
    expect(config.description).toContain('CRAAP');
    expect(config.schedule).toBe('0 */6 * * *');
    expect(config.taskPrompt).toBe('Conduct deep research on assigned topics.');
    expect(config.requiresApproval).toBe(false);
    expect(config.outputMode).toBe('comment');
    expect(config.innerAdapter).toBe('claude_code');
    expect(config.innerAdapterConfig).toEqual({ timeout: 300 });
    expect(config.settings).toEqual({ methodology: 'CRAAP', max_sources: 5 });
    expect(config.metrics).toEqual(['sources_evaluated', 'facts_discovered']);
    expect(config.tools).toEqual([]);
    expect(config.ownerAgentId).toBeNull();
  });

  it('parses minimal TOML with defaults', () => {
    const config = parseHandToml(MINIMAL_TOML);

    expect(config.name).toBe('minimal');
    expect(config.innerAdapter).toBe('process');
    expect(config.requiresApproval).toBe(false);
    expect(config.outputMode).toBe('comment');
    expect(config.tools).toEqual([]);
    expect(config.metrics).toEqual([]);
    expect(config.settings).toEqual({});
    expect(config.innerAdapterConfig).toEqual({});
  });

  it('throws on invalid TOML syntax', () => {
    expect(() => parseHandToml('not [valid toml')).toThrow();
  });

  it('throws on missing required fields', () => {
    const incomplete = `
[hand]
name = "test"
`;
    expect(() => parseHandToml(incomplete)).toThrow();
  });

  it('validates output mode values', () => {
    const withFactMode = MINIMAL_TOML.replace(
      'task_prompt = "Do something"',
      'task_prompt = "Do something"\noutput_mode = "fact"',
    );
    const config = parseHandToml(withFactMode);
    expect(config.outputMode).toBe('fact');
  });

  it('rejects invalid output mode', () => {
    const withBadMode = `
[hand]
name = "test"
description = "Test"
schedule = "* * * * *"
task_prompt = "Do something"
output_mode = "invalid"

[adapter]
type = "process"
`;
    expect(() => parseHandToml(withBadMode)).toThrow();
  });

  it('handles snake_case to camelCase conversion', () => {
    const toml = `
[hand]
name = "test"
description = "Test hand"
schedule = "0 * * * *"
task_prompt = "Do work"
requires_approval = true
output_mode = "silent"
owner_agent_id = "550e8400-e29b-41d4-a716-446655440000"

[adapter]
type = "http"
`;
    const config = parseHandToml(toml);
    expect(config.requiresApproval).toBe(true);
    expect(config.outputMode).toBe('silent');
    expect(config.ownerAgentId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });
});
