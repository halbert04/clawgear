/**
 * AuditChain — append-only Merkle hash-chain for tamper-evident logging.
 * Each entry is cryptographically linked to its predecessor via chain hashes.
 */

import { computeChainHash, computeEntryHash, computeMerkleRoot } from './hasher.js';
import type { AuditChainConfig, AuditEntry, AuditEntryInput, MerkleProof } from './types.js';

export class AuditChain {
  private readonly entries: AuditEntry[] = [];
  private readonly config: AuditChainConfig;

  constructor(config: AuditChainConfig) {
    this.config = config;
  }

  /** Append a new entry to the chain. Returns the completed entry with hashes. */
  async append(input: AuditEntryInput): Promise<AuditEntry> {
    const sequence = this.entries.length;
    const previousEntry = sequence > 0 ? this.entries[sequence - 1]! : null;
    const previousHash = previousEntry?.chainHash ?? null;

    const entryHash = await computeEntryHash(input);
    const chainHash = await computeChainHash(previousHash, entryHash);

    const entry: AuditEntry = {
      id: input.id,
      sequence,
      timestamp: new Date().toISOString(),
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      details: input.details ?? null,
      entryHash,
      previousHash,
      chainHash,
    };

    this.entries.push(entry);
    return entry;
  }

  /** Load existing entries into the chain (e.g., from database). */
  load(entries: AuditEntry[]): void {
    this.entries.length = 0;
    for (const entry of entries) {
      this.entries.push(entry);
    }
  }

  /** Get all entries in the chain */
  getEntries(): ReadonlyArray<AuditEntry> {
    return this.entries;
  }

  /** Get the latest chain hash (head of the chain) */
  getHead(): string | null {
    if (this.entries.length === 0) return null;
    return this.entries[this.entries.length - 1]!.chainHash;
  }

  /** Get the chain length */
  getLength(): number {
    return this.entries.length;
  }

  /** Get config */
  getConfig(): Readonly<AuditChainConfig> {
    return { ...this.config };
  }

  /** Compute the Merkle root of all chain hashes */
  async getMerkleRoot(): Promise<string> {
    const chainHashes = this.entries.map((e) => e.chainHash);
    return computeMerkleRoot(chainHashes);
  }

  /**
   * Generate a Merkle proof for a specific entry by sequence number.
   * Proves that the entry's chain hash is included in the Merkle tree.
   */
  async generateProof(sequence: number): Promise<MerkleProof | null> {
    if (sequence < 0 || sequence >= this.entries.length) {
      return null;
    }

    const chainHashes = this.entries.map((e) => e.chainHash);
    const entryHash = chainHashes[sequence]!;
    const siblings: MerkleProof['siblings'] = [];

    let level = [...chainHashes];
    let index = sequence;

    while (level.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i]!;
        const right = level[i + 1] ?? left;

        if (i === index || i + 1 === index) {
          if (i === index && i + 1 < level.length) {
            siblings.push({ hash: right, position: 'right' });
          } else if (i + 1 === index) {
            siblings.push({ hash: left, position: 'left' });
          } else {
            // Odd leaf duplicated — sibling is itself
            siblings.push({ hash: left, position: 'right' });
          }
        }

        nextLevel.push(left + right); // placeholder — actual hash computed during verify
        index = Math.floor(index / 2);
      }
      level = nextLevel;
    }

    const rootHash = await this.getMerkleRoot();
    return { entryHash, siblings, rootHash };
  }
}
