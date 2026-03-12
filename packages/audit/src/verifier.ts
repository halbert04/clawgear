/**
 * Verification utilities for the Merkle hash-chain audit system.
 * Detects tampering, broken links, and hash mismatches.
 */

import { computeChainHash, computeEntryHash, sha256 } from './hasher.js';
import type {
  AuditEntry,
  ChainVerificationResult,
  EntryVerificationResult,
  MerkleProof,
} from './types.js';

/**
 * Verify a single audit entry's integrity.
 * Checks that entryHash matches content and chainHash matches previousHash + entryHash.
 */
export async function verifyEntry(entry: AuditEntry): Promise<EntryVerificationResult> {
  // Recompute entry hash from content
  const expectedEntryHash = await computeEntryHash({
    id: entry.id,
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: entry.details,
  });

  const entryHashValid = expectedEntryHash === entry.entryHash;

  // Recompute chain hash
  const expectedChainHash = await computeChainHash(entry.previousHash, entry.entryHash);
  const chainHashValid = expectedChainHash === entry.chainHash;

  const valid = entryHashValid && chainHashValid;
  let error: string | null = null;

  if (!entryHashValid) {
    error = `Entry hash mismatch at sequence ${entry.sequence}: expected ${expectedEntryHash}, got ${entry.entryHash}`;
  } else if (!chainHashValid) {
    error = `Chain hash mismatch at sequence ${entry.sequence}: expected ${expectedChainHash}, got ${entry.chainHash}`;
  }

  return { valid, entryHashValid, chainHashValid, error };
}

/**
 * Verify the entire audit chain from genesis to head.
 * Checks every entry's hashes and verifies links between consecutive entries.
 */
export async function verifyChain(
  entries: ReadonlyArray<AuditEntry>,
): Promise<ChainVerificationResult> {
  const start = performance.now();

  if (entries.length === 0) {
    return {
      valid: true,
      entriesVerified: 0,
      brokenAtSequence: null,
      error: null,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
    };
  }

  // Verify genesis entry has no previous hash
  const genesis = entries[0]!;
  if (genesis.previousHash !== null) {
    return {
      valid: false,
      entriesVerified: 0,
      brokenAtSequence: 0,
      error: 'Genesis entry must have null previousHash',
      durationMs: Math.round((performance.now() - start) * 100) / 100,
    };
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;

    // Verify sequence is correct
    if (entry.sequence !== i) {
      return {
        valid: false,
        entriesVerified: i,
        brokenAtSequence: i,
        error: `Sequence mismatch at index ${i}: expected ${i}, got ${entry.sequence}`,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
      };
    }

    // Verify entry integrity
    const entryResult = await verifyEntry(entry);
    if (!entryResult.valid) {
      return {
        valid: false,
        entriesVerified: i,
        brokenAtSequence: i,
        error: entryResult.error,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
      };
    }

    // Verify link to previous entry
    if (i > 0) {
      const prev = entries[i - 1]!;
      if (entry.previousHash !== prev.chainHash) {
        return {
          valid: false,
          entriesVerified: i,
          brokenAtSequence: i,
          error: `Broken chain link at sequence ${i}: previousHash does not match preceding chainHash`,
          durationMs: Math.round((performance.now() - start) * 100) / 100,
        };
      }
    }
  }

  return {
    valid: true,
    entriesVerified: entries.length,
    brokenAtSequence: null,
    error: null,
    durationMs: Math.round((performance.now() - start) * 100) / 100,
  };
}

/**
 * Verify a Merkle proof for a single entry.
 * Reconstructs the root by hashing through the sibling path.
 */
export async function verifyMerkleProof(proof: MerkleProof): Promise<boolean> {
  let current = proof.entryHash;

  for (const sibling of proof.siblings) {
    if (sibling.position === 'left') {
      current = await sha256(sibling.hash + current);
    } else {
      current = await sha256(current + sibling.hash);
    }
  }

  return current === proof.rootHash;
}
