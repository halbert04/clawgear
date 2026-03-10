import type { EventBus, InputSource, SecurityGate, SystemEvent } from '@clawgear/shared/interfaces';
import type { Capability } from '@clawgear/shared/types';
import { hasCapability, mapToolToCapability } from './capability-enforcer.js';

export interface SecurityGateConfig {
  /** Function to look up an agent's capabilities by ID */
  getAgentCapabilities: (agentId: string) => Promise<Capability[]>;
  /** Optional event bus for audit logging */
  eventBus?: EventBus;
  /** Optional company ID resolver for events */
  getAgentCompanyId?: (agentId: string) => Promise<string>;
  /** Secret patterns to redact from output */
  secretPatterns?: RegExp[];
}

const SYSTEM_MARKERS = [
  '<|system|>',
  '<|assistant|>',
  '<|user|>',
  '<<SYS>>',
  '<</SYS>>',
  '[INST]',
  '[/INST]',
];

// Patterns that suggest prompt injection
const INJECTION_PATTERNS = [
  /\[SYSTEM\]/gi,
  /\[INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /Human:\s/gi,
  /Assistant:\s/gi,
  /ignore (?:all )?(?:previous|above) instructions/gi,
  /you are now/gi,
  /new instructions:/gi,
  /override system prompt/gi,
  /disregard (?:all )?(?:previous|prior) (?:instructions|context)/gi,
];

// Patterns that suggest data exfiltration
const EXFILTRATION_PATTERNS = [
  // Large base64 blobs (>100 chars)
  /(?:[A-Za-z0-9+/]{100,}={0,2})/,
  // Hex-encoded blobs (>64 chars)
  /(?:[0-9a-fA-F]{64,})/,
  // URL-encoded data blobs
  /(?:%[0-9a-fA-F]{2}){20,}/,
  // Data URIs with significant content
  /data:[^;]{1,50};base64,[A-Za-z0-9+/]{100,}/,
];

export class EnhancedSecurityGate implements SecurityGate {
  private config: SecurityGateConfig;

  constructor(config: SecurityGateConfig) {
    this.config = config;
  }

  async validateToolCall(agentId: string, tool: string, args: unknown): Promise<boolean> {
    const parsedArgs = (args as Record<string, unknown>) ?? {};
    const required = mapToolToCapability(tool, parsedArgs);

    // Tools with no capability requirement are always allowed
    if (!required) return true;

    const capabilities = await this.config.getAgentCapabilities(agentId);
    const allowed = hasCapability(capabilities, required);

    if (!allowed) {
      await this.logSecurityEvent('capability.denied', agentId, {
        tool,
        args: parsedArgs,
        requiredCapability: required,
        heldCapabilities: capabilities,
      });
    }

    return allowed;
  }

  sanitizeInput(input: string, source: InputSource): string {
    if (source === 'system') {
      return input; // Trust system content
    }

    let sanitized = input;
    let injectionDetected = false;

    // Check for injection patterns
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(sanitized)) {
        injectionDetected = true;
        sanitized = sanitized.replace(pattern, '[FILTERED]');
      }
    }

    // Escape system markers
    for (const marker of SYSTEM_MARKERS) {
      sanitized = sanitized.replaceAll(marker, `[ESCAPED:${marker}]`);
    }

    // Log injection attempt (fire-and-forget)
    if (injectionDetected) {
      this.logSecurityEvent('injection.input_detected', 'system', {
        source,
        originalLength: input.length,
        sanitizedLength: sanitized.length,
      });
    }

    // Wrap untrusted content in XML delimiters
    if (source === 'user' || source === 'web' || source === 'channel') {
      return `<untrusted_content source="${source}">\n${sanitized}\n</untrusted_content>`;
    }

    return sanitized;
  }

  sanitizeOutput(output: string): string {
    let sanitized = output;

    // Remove system markers
    for (const marker of SYSTEM_MARKERS) {
      sanitized = sanitized.replaceAll(marker, '');
    }

    // Check for exfiltration
    const hasExfiltration = EXFILTRATION_PATTERNS.some((p) => p.test(sanitized));
    if (hasExfiltration) {
      this.logSecurityEvent('injection.output_exfiltration', 'system', {
        outputLength: output.length,
      });
      // Strip the detected patterns
      for (const pattern of EXFILTRATION_PATTERNS) {
        sanitized = sanitized.replace(new RegExp(pattern.source, 'g'), '[REDACTED]');
      }
    }

    // Redact known secrets
    sanitized = this.redactSecrets(sanitized);

    return sanitized;
  }

  private redactSecrets(text: string): string {
    let result = text;
    if (this.config.secretPatterns) {
      for (const pattern of this.config.secretPatterns) {
        result = result.replace(pattern, '[SECRET_REDACTED]');
      }
    }
    return result;
  }

  private async logSecurityEvent(
    type: string,
    agentId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.config.eventBus) return;

    let companyId = 'system';
    if (agentId !== 'system' && this.config.getAgentCompanyId) {
      try {
        companyId = await this.config.getAgentCompanyId(agentId);
      } catch {
        // Best effort — don't block on lookup failure
      }
    }

    const event: SystemEvent = {
      type: `security.${type}`,
      companyId,
      timestamp: new Date(),
      payload: { ...payload, agentId },
    };
    this.config.eventBus.emit(event);
  }
}
