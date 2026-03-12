export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  tags: string[];
  capabilities: string[];
  /** SHA-256 hash of the skill package content */
  checksum: string;
}

export interface PublishedSkill {
  id: string;
  companyId: string;
  manifest: SkillManifest;
  /** Ed25519 signature of the manifest JSON (hex-encoded) */
  signature: string;
  /** Ed25519 public key of the publisher (hex-encoded) */
  publisherKey: string;
  /** Base64-encoded tarball of the skill package */
  packageData: string;
  downloads: number;
  status: 'published' | 'unpublished' | 'flagged';
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillSearchResult {
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  downloads: number;
  verified: boolean;
}

export interface SecurityScanResult {
  passed: boolean;
  issues: SecurityIssue[];
}

export interface SecurityIssue {
  severity: 'critical' | 'warning' | 'info';
  pattern: string;
  file: string;
  line: number;
  message: string;
}
