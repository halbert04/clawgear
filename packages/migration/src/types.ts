export type MigrationSource = 'paperclip' | 'openfang' | 'openclaw';

export interface MigrationOptions {
  source: MigrationSource;
  companyId: string;
  data: unknown;
  dryRun: boolean;
}

export interface MigrationContext {
  companyId: string;
  source: MigrationSource;
  dryRun: boolean;
  idMaps: {
    companies: Map<string, string>;
    agents: Map<string, string>;
    goals: Map<string, string>;
    projects: Map<string, string>;
    issues: Map<string, string>;
    skills: Map<string, string>;
  };
  errors: MigrationError[];
  warnings: MigrationError[];
  counts: Record<string, number>;
}

export interface MigrationError {
  entityType: string;
  entityId: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface MigrationReport {
  source: MigrationSource;
  companyId: string;
  dryRun: boolean;
  status: 'success' | 'partial' | 'failed';
  counts: Record<string, number>;
  errors: MigrationError[];
  warnings: MigrationError[];
  idMappings: Record<string, Record<string, string>>;
}

// Source data schemas for each migration source
export interface PaperclipData {
  companies: PaperclipCompany[];
  agents: PaperclipAgent[];
  goals: PaperclipGoal[];
  projects: PaperclipProject[];
  issues: PaperclipIssue[];
}

export interface PaperclipCompany {
  id: string;
  name: string;
  description?: string;
  issuePrefix?: string;
}

export interface PaperclipAgent {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title?: string;
  systemPrompt?: string;
}

export interface PaperclipGoal {
  id: string;
  companyId: string;
  parentId?: string;
  title: string;
  description?: string;
  level?: string;
}

export interface PaperclipProject {
  id: string;
  companyId: string;
  goalId?: string;
  name: string;
}

export interface PaperclipIssue {
  id: string;
  companyId: string;
  projectId?: string;
  goalId?: string;
  parentId?: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
}

export interface OpenfangData {
  agents: OpenfangAgent[];
  skills: OpenfangSkill[];
  facts: OpenfangFact[];
  lessons: OpenfangLesson[];
}

export interface OpenfangAgent {
  id: string;
  name: string;
  role: string;
  config?: Record<string, unknown>;
}

export interface OpenfangSkill {
  id: string;
  agentId: string;
  name: string;
  version?: number;
  content: string;
}

export interface OpenfangFact {
  id: string;
  agentId: string;
  factType: string;
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
}

export interface OpenfangLesson {
  id: string;
  agentId: string;
  taskType: string;
  approach: string;
  lesson: string;
  outcome: string;
  confidence?: number;
}

export interface OpenclawData {
  config: OpenclawConfig[];
  sessions: OpenclawSession[];
  skills: OpenclawSkill[];
  triggers: OpenclawTrigger[];
  workflows: OpenclawWorkflow[];
}

export interface OpenclawConfig {
  id: string;
  agentId: string;
  key: string;
  value: unknown;
}

export interface OpenclawSession {
  id: string;
  agentId: string;
  state: Record<string, unknown>;
}

export interface OpenclawSkill {
  id: string;
  agentId: string;
  name: string;
  content: string;
  version?: number;
}

export interface OpenclawTrigger {
  id: string;
  name: string;
  patternType: string;
  patternConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
}

export interface OpenclawWorkflow {
  id: string;
  name: string;
  definition: Record<string, unknown>;
}
