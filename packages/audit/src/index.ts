export { AuditChain } from './chain.js';
export { computeChainHash, computeEntryHash, computeMerkleRoot, sha256 } from './hasher.js';
export type {
  AuditChainConfig,
  AuditEntry,
  AuditEntryInput,
  ChainVerificationResult,
  EntryVerificationResult,
  MerkleProof,
} from './types.js';
export { DEFAULT_AUDIT_CONFIG } from './types.js';
export { verifyChain, verifyEntry, verifyMerkleProof } from './verifier.js';
