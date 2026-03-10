import type { InputSource, SecurityGate } from '@clawgear/shared/interfaces';

const SYSTEM_MARKERS = [
  '<|system|>',
  '<|assistant|>',
  '<|user|>',
  '<<SYS>>',
  '<</SYS>>',
  '[INST]',
  '[/INST]',
];

export class BasicSecurityGate implements SecurityGate {
  async validateToolCall(_agentId: string, _tool: string, _args: unknown): Promise<boolean> {
    // Phase 2: pass-through. Full RBAC in Phase 3.
    return true;
  }

  sanitizeInput(input: string, source: InputSource): string {
    if (source === 'system') {
      return input; // Trust system content
    }

    // Wrap untrusted content in XML delimiters
    let sanitized = input;

    // Escape system markers in untrusted content
    for (const marker of SYSTEM_MARKERS) {
      sanitized = sanitized.replaceAll(marker, `[ESCAPED:${marker}]`);
    }

    if (source === 'user' || source === 'web' || source === 'channel') {
      return `<untrusted_content source="${source}">\n${sanitized}\n</untrusted_content>`;
    }

    return sanitized;
  }

  sanitizeOutput(output: string): string {
    let sanitized = output;

    // Remove any system markers from output
    for (const marker of SYSTEM_MARKERS) {
      sanitized = sanitized.replaceAll(marker, '');
    }

    return sanitized;
  }
}
