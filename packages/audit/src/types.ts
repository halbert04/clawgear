/**
 * Types for Merkle hash-chain audit system.
 * Provides cryptographically linked, tamper-evident action logging.
 */

/** A single entry in the audit chain */
export interface AuditEntry {
  /** Unique entry ID */
  id: string;
  /** Sequence number in the chain (0-based) */
  sequence: number;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Actor who performed the action */
  actorType: 'agent' | 'user' | 'system';
  actorId: string;
  /** Action performed */
  action: string;
  /** Entity affected */
  entityType: string;
  entityId: string | null;
  /** Additional event data */
  details: Record<string, unknown> | null;
  /** SHA-256 hash of this entry's content */
  entryHash: string;
  /** Hash of the previous entry (null for genesis) */
  previousHash: string | null;
  /** Chain hash: SHA-256(previousHash + entryHash) */
  chainHash: string;
}

/** Input for creating a new audit entry (before hashing) */
export interface AuditEntryInput {
  id: string;
  actorType: 'agent' | 'user' | 'system';
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}

/** Merkle proof for verifying a single entry's membership in the chain */
export interface MerkleProof {
  /** The entry being proved */
  entryHash: string;
  /** Sequence of sibling hashes needed to reconstruct the root */
  siblings: Array<{
    hash: string;
    position: 'left' | 'right';
  }>;
  /** Expected Merkle root hash */
  rootHash: string;
}

/** Result of verifying the audit chain */
export interface ChainVerificationResult {
  /** Whether the entire chain is valid */
  valid: boolean;
  /** Total entries verified */
  entriesVerified: number;
  /** First broken link, if any */
  brokenAtSequence: number | null;
  /** Description of the failure */
  error: string | null;
  /** Duration of verification in ms */
  durationMs: number;
}

/** Result of verifying a single entry */
export interface EntryVerificationResult {
  /** Whether this entry's hashes are valid */
  valid: boolean;
  /** Whether the entry hash matches its content */
  entryHashValid: boolean;
  /** Whether the chain hash matches previousHash + entryHash */
  chainHashValid: boolean;
  /** Error description if invalid */
  error: string | null;
}

/** Configuration for the audit chain */
export interface AuditChainConfig {
  /** Algorithm for hashing (default: SHA-256) */
  algorithm: string;
  /** Company ID this chain belongs to */
  companyId: string;
}

export const DEFAULT_AUDIT_CONFIG: AuditChainConfig = {
  algorithm: 'SHA-256',
  companyId: '',
};
