/**
 * SHA-256 hashing utilities for the audit chain.
 * Uses the Web Crypto API (available in Bun/Node/Browser).
 */

import type { AuditEntryInput } from './types.js';

/** Convert a Uint8Array to a hex string */
function toHex(bytes: Uint8Array): string {
  const hexArray: string[] = [];
  for (const b of bytes) {
    hexArray.push(b.toString(16).padStart(2, '0'));
  }
  return hexArray.join('');
}

/** Compute SHA-256 hash of a string, returning hex */
export async function sha256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return toHex(new Uint8Array(hashBuffer));
}

/**
 * Compute the entry hash from the entry's content fields.
 * Deterministic: sorts keys to ensure consistent hashing regardless of field order.
 */
export async function computeEntryHash(input: AuditEntryInput): Promise<string> {
  const canonical = JSON.stringify({
    id: input.id,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    details: input.details ?? null,
  });
  return sha256(canonical);
}

/**
 * Compute the chain hash linking this entry to its predecessor.
 * chainHash = SHA-256(previousHash + entryHash)
 * For the genesis entry (no predecessor), chainHash = SHA-256("GENESIS" + entryHash)
 */
export async function computeChainHash(
  previousHash: string | null,
  entryHash: string,
): Promise<string> {
  const prefix = previousHash ?? 'GENESIS';
  return sha256(prefix + entryHash);
}

/**
 * Compute the Merkle root hash from a list of leaf hashes.
 * Uses a binary Merkle tree. If the number of leaves is odd,
 * the last leaf is duplicated to complete the pair.
 */
export async function computeMerkleRoot(leafHashes: string[]): Promise<string> {
  if (leafHashes.length === 0) {
    return sha256('EMPTY_TREE');
  }
  if (leafHashes.length === 1) {
    return leafHashes[0]!;
  }

  let level = [...leafHashes];

  while (level.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left; // duplicate last if odd
      nextLevel.push(await sha256(left + right));
    }
    level = nextLevel;
  }

  return level[0]!;
}
