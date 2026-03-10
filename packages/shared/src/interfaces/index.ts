import type { Capability, CostEvent as CostEventType } from '../types/index.js';

// ============================================================
// KERNEL HANDLE
// ============================================================

export interface BudgetStatus {
  budgetCents: bigint;
  spentCents: bigint;
  remainingCents: bigint;
  percentUsed: number;
  isExhausted: boolean;
  isWarning: boolean;
}

export interface KernelHandle {
  checkBudget(agentId: string): Promise<BudgetStatus>;
  checkCapability(agentId: string, capability: Capability): Promise<boolean>;
  emitEvent(event: SystemEvent): void;
  recordCost(event: Omit<CostEventType, 'id' | 'occurredAt'>): Promise<void>;
}

// ============================================================
// SECURITY GATE
// ============================================================

export type InputSource = 'system' | 'user' | 'agent' | 'web' | 'api' | 'channel';

export interface SecurityGate {
  validateToolCall(agentId: string, tool: string, args: unknown): Promise<boolean>;
  sanitizeInput(input: string, source: InputSource): string;
  sanitizeOutput(output: string): string;
}

// ============================================================
// EVENT BUS
// ============================================================

export interface SystemEvent {
  type: string;
  companyId: string;
  timestamp: Date;
  payload: Record<string, unknown>;
}

export interface EventSubscription {
  unsubscribe(): void;
}

export interface EventBus {
  emit(event: SystemEvent): void;
  on(eventType: string, handler: (event: SystemEvent) => void): EventSubscription;
  once(eventType: string, handler: (event: SystemEvent) => void): EventSubscription;
}

// ============================================================
// ADAPTER
// ============================================================

export interface AdapterContext {
  agentId: string;
  companyId: string;
  systemPrompt: string;
  taskPrompt: string;
  tools: ToolDefinition[];
  sessionId: string | null;
  timeout: number;
}

export interface AdapterResult {
  output: string;
  toolCalls: ToolCallRecord[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    provider: string;
    model: string;
  };
  sessionId: string | null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

export interface EnvironmentTestResult {
  ok: boolean;
  adapter: string;
  checks: { name: string; passed: boolean; message: string }[];
}

export interface Adapter {
  readonly name: string;
  execute(ctx: AdapterContext): Promise<AdapterResult>;
  testEnvironment(): Promise<EnvironmentTestResult>;
  serializeSession?(session: unknown): string;
  deserializeSession?(data: string): unknown;
}

// ============================================================
// CHANNEL
// ============================================================

export interface InboundMessage {
  channelName: string;
  externalId: string;
  senderId: string;
  senderName: string;
  content: string;
  threadId: string | null;
  metadata: Record<string, unknown>;
}

export interface OutboundMessage {
  channelName: string;
  recipientId: string;
  content: string;
  threadId: string | null;
  metadata: Record<string, unknown>;
}

export interface ChannelConfig {
  [key: string]: unknown;
}

export interface ChannelAdapter {
  readonly name: string;
  init(config: ChannelConfig): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
  shutdown(): Promise<void>;
}
