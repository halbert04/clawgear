import { describe, expect, it } from 'bun:test';
import { AuditChain } from './chain.js';
import { computeChainHash, computeEntryHash, computeMerkleRoot, sha256 } from './hasher.js';
import type { AuditEntry, AuditEntryInput } from './types.js';
import { DEFAULT_AUDIT_CONFIG } from './types.js';
import { verifyChain, verifyEntry, verifyMerkleProof } from './verifier.js';

// ---------------------------------------------------------------------------
// Hasher tests
// ---------------------------------------------------------------------------
describe('sha256', () => {
  it('should produce consistent hashes', async () => {
    const h1 = await sha256('hello');
    const h2 = await sha256('hello');
    expect(h1).toBe(h2);
  });

  it('should produce different hashes for different inputs', async () => {
    const h1 = await sha256('hello');
    const h2 = await sha256('world');
    expect(h1).not.toBe(h2);
  });

  it('should produce 64-character hex string', async () => {
    const h = await sha256('test');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });
});

describe('computeEntryHash', () => {
  it('should produce deterministic hash from entry content', async () => {
    const input: AuditEntryInput = {
      id: 'entry-1',
      actorType: 'agent',
      actorId: 'agent-1',
      action: 'tool_call',
      entityType: 'tool',
      entityId: 'tool-1',
    };
    const h1 = await computeEntryHash(input);
    const h2 = await computeEntryHash(input);
    expect(h1).toBe(h2);
  });

  it('should differ when content changes', async () => {
    const h1 = await computeEntryHash({
      id: 'entry-1',
      actorType: 'agent',
      actorId: 'agent-1',
      action: 'tool_call',
      entityType: 'tool',
    });
    const h2 = await computeEntryHash({
      id: 'entry-1',
      actorType: 'agent',
      actorId: 'agent-1',
      action: 'different_action',
      entityType: 'tool',
    });
    expect(h1).not.toBe(h2);
  });
});

describe('computeChainHash', () => {
  it('should use GENESIS prefix for first entry', async () => {
    const entryHash = await sha256('test');
    const chain = await computeChainHash(null, entryHash);
    const expected = await sha256(`GENESIS${entryHash}`);
    expect(chain).toBe(expected);
  });

  it('should link to previous hash', async () => {
    const prevHash = await sha256('prev');
    const entryHash = await sha256('current');
    const chain = await computeChainHash(prevHash, entryHash);
    const expected = await sha256(prevHash + entryHash);
    expect(chain).toBe(expected);
  });
});

describe('computeMerkleRoot', () => {
  it('should handle empty list', async () => {
    const root = await computeMerkleRoot([]);
    const expected = await sha256('EMPTY_TREE');
    expect(root).toBe(expected);
  });

  it('should return single hash for one leaf', async () => {
    const h = await sha256('leaf');
    const root = await computeMerkleRoot([h]);
    expect(root).toBe(h);
  });

  it('should combine two leaves', async () => {
    const a = await sha256('a');
    const b = await sha256('b');
    const root = await computeMerkleRoot([a, b]);
    const expected = await sha256(a + b);
    expect(root).toBe(expected);
  });

  it('should handle odd number of leaves', async () => {
    const a = await sha256('a');
    const b = await sha256('b');
    const c = await sha256('c');
    const root = await computeMerkleRoot([a, b, c]);
    // Tree: hash(hash(a,b), hash(c,c))
    const left = await sha256(a + b);
    const right = await sha256(c + c);
    const expected = await sha256(left + right);
    expect(root).toBe(expected);
  });

  it('should produce consistent results', async () => {
    const leaves = [await sha256('x'), await sha256('y'), await sha256('z'), await sha256('w')];
    const r1 = await computeMerkleRoot(leaves);
    const r2 = await computeMerkleRoot(leaves);
    expect(r1).toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// AuditChain tests
// ---------------------------------------------------------------------------
describe('AuditChain', () => {
  const config = { algorithm: 'SHA-256', companyId: 'company-1' };

  it('should start empty', () => {
    const chain = new AuditChain(config);
    expect(chain.getLength()).toBe(0);
    expect(chain.getHead()).toBeNull();
    expect(chain.getEntries()).toHaveLength(0);
  });

  it('should append genesis entry with null previousHash', async () => {
    const chain = new AuditChain(config);
    const entry = await chain.append({
      id: 'e1',
      actorType: 'user',
      actorId: 'user-1',
      action: 'login',
      entityType: 'session',
    });
    expect(entry.sequence).toBe(0);
    expect(entry.previousHash).toBeNull();
    expect(entry.entryHash).toHaveLength(64);
    expect(entry.chainHash).toHaveLength(64);
    expect(chain.getLength()).toBe(1);
    expect(chain.getHead()).toBe(entry.chainHash);
  });

  it('should link entries via previousHash', async () => {
    const chain = new AuditChain(config);
    const e1 = await chain.append({
      id: 'e1',
      actorType: 'user',
      actorId: 'u1',
      action: 'create',
      entityType: 'agent',
    });
    const e2 = await chain.append({
      id: 'e2',
      actorType: 'agent',
      actorId: 'a1',
      action: 'execute',
      entityType: 'tool',
    });
    expect(e2.previousHash).toBe(e1.chainHash);
    expect(e2.sequence).toBe(1);
    expect(chain.getHead()).toBe(e2.chainHash);
  });

  it('should build a multi-entry chain', async () => {
    const chain = new AuditChain(config);
    for (let i = 0; i < 5; i++) {
      await chain.append({
        id: `e${i}`,
        actorType: 'system',
        actorId: 'sys',
        action: `action_${i}`,
        entityType: 'test',
      });
    }
    expect(chain.getLength()).toBe(5);
    const entries = chain.getEntries();
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.previousHash).toBe(entries[i - 1]!.chainHash);
    }
  });

  it('should load existing entries', async () => {
    const chain1 = new AuditChain(config);
    await chain1.append({
      id: 'e1',
      actorType: 'user',
      actorId: 'u1',
      action: 'create',
      entityType: 'agent',
    });
    await chain1.append({
      id: 'e2',
      actorType: 'agent',
      actorId: 'a1',
      action: 'run',
      entityType: 'tool',
    });

    const chain2 = new AuditChain(config);
    chain2.load([...chain1.getEntries()]);
    expect(chain2.getLength()).toBe(2);
    expect(chain2.getHead()).toBe(chain1.getHead());
  });

  it('should compute Merkle root', async () => {
    const chain = new AuditChain(config);
    await chain.append({
      id: 'e1',
      actorType: 'user',
      actorId: 'u1',
      action: 'a',
      entityType: 't',
    });
    await chain.append({
      id: 'e2',
      actorType: 'user',
      actorId: 'u1',
      action: 'b',
      entityType: 't',
    });
    const root = await chain.getMerkleRoot();
    expect(root).toHaveLength(64);
  });

  it('should return config', () => {
    const chain = new AuditChain(config);
    expect(chain.getConfig().algorithm).toBe('SHA-256');
    expect(chain.getConfig().companyId).toBe('company-1');
  });
});

// ---------------------------------------------------------------------------
// Verifier tests
// ---------------------------------------------------------------------------
describe('verifyEntry', () => {
  it('should validate a correctly hashed entry', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    const entry = await chain.append({
      id: 'e1',
      actorType: 'user',
      actorId: 'u1',
      action: 'login',
      entityType: 'session',
    });
    const result = await verifyEntry(entry);
    expect(result.valid).toBe(true);
    expect(result.entryHashValid).toBe(true);
    expect(result.chainHashValid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('should detect tampered entry hash', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    const entry = await chain.append({
      id: 'e1',
      actorType: 'user',
      actorId: 'u1',
      action: 'login',
      entityType: 'session',
    });
    const tampered: AuditEntry = { ...entry, entryHash: 'deadbeef'.repeat(8) };
    const result = await verifyEntry(tampered);
    expect(result.valid).toBe(false);
    expect(result.entryHashValid).toBe(false);
  });

  it('should detect tampered chain hash', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    const entry = await chain.append({
      id: 'e1',
      actorType: 'user',
      actorId: 'u1',
      action: 'login',
      entityType: 'session',
    });
    const tampered: AuditEntry = { ...entry, chainHash: 'cafebabe'.repeat(8) };
    const result = await verifyEntry(tampered);
    expect(result.valid).toBe(false);
    expect(result.chainHashValid).toBe(false);
  });

  it('should detect content modification', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    const entry = await chain.append({
      id: 'e1',
      actorType: 'user',
      actorId: 'u1',
      action: 'login',
      entityType: 'session',
    });
    const tampered: AuditEntry = { ...entry, action: 'TAMPERED_ACTION' };
    const result = await verifyEntry(tampered);
    expect(result.valid).toBe(false);
    expect(result.entryHashValid).toBe(false);
  });
});

describe('verifyChain', () => {
  it('should verify empty chain', async () => {
    const result = await verifyChain([]);
    expect(result.valid).toBe(true);
    expect(result.entriesVerified).toBe(0);
  });

  it('should verify valid chain', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    for (let i = 0; i < 5; i++) {
      await chain.append({
        id: `e${i}`,
        actorType: 'system',
        actorId: 'sys',
        action: `action_${i}`,
        entityType: 'test',
      });
    }
    const result = await verifyChain(chain.getEntries());
    expect(result.valid).toBe(true);
    expect(result.entriesVerified).toBe(5);
    expect(result.brokenAtSequence).toBeNull();
    expect(result.error).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should detect broken link in chain', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    for (let i = 0; i < 3; i++) {
      await chain.append({
        id: `e${i}`,
        actorType: 'system',
        actorId: 'sys',
        action: `action_${i}`,
        entityType: 'test',
      });
    }
    const entries = [...chain.getEntries()];
    // Break the link by modifying entry 1's previousHash
    entries[1] = { ...entries[1]!, previousHash: 'broken_hash' };
    const result = await verifyChain(entries);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(1);
  });

  it('should detect tampered content in chain', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    for (let i = 0; i < 3; i++) {
      await chain.append({
        id: `e${i}`,
        actorType: 'system',
        actorId: 'sys',
        action: `action_${i}`,
        entityType: 'test',
      });
    }
    const entries = [...chain.getEntries()];
    // Tamper with content of middle entry
    entries[1] = { ...entries[1]!, action: 'TAMPERED' };
    const result = await verifyChain(entries);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(1);
  });

  it('should detect genesis with non-null previousHash', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    await chain.append({
      id: 'e0',
      actorType: 'system',
      actorId: 'sys',
      action: 'boot',
      entityType: 'test',
    });
    const entries = [...chain.getEntries()];
    entries[0] = { ...entries[0]!, previousHash: 'should_be_null' };
    const result = await verifyChain(entries);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(0);
    expect(result.error).toContain('Genesis');
  });

  it('should detect sequence gap', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    for (let i = 0; i < 3; i++) {
      await chain.append({
        id: `e${i}`,
        actorType: 'system',
        actorId: 'sys',
        action: `action_${i}`,
        entityType: 'test',
      });
    }
    const entries = [...chain.getEntries()];
    // Skip sequence number
    entries[2] = { ...entries[2]!, sequence: 5 };
    const result = await verifyChain(entries);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(2);
    expect(result.error).toContain('Sequence');
  });
});

describe('verifyMerkleProof', () => {
  it('should verify a valid proof for a two-entry chain', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    await chain.append({
      id: 'e0',
      actorType: 'user',
      actorId: 'u1',
      action: 'a',
      entityType: 't',
    });
    await chain.append({
      id: 'e1',
      actorType: 'user',
      actorId: 'u1',
      action: 'b',
      entityType: 't',
    });
    const proof = await chain.generateProof(0);
    expect(proof).not.toBeNull();
    const valid = await verifyMerkleProof(proof!);
    expect(valid).toBe(true);
  });

  it('should return null for out-of-range sequence', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    await chain.append({
      id: 'e0',
      actorType: 'user',
      actorId: 'u1',
      action: 'a',
      entityType: 't',
    });
    const proof = await chain.generateProof(5);
    expect(proof).toBeNull();
  });

  it('should reject proof with wrong root hash', async () => {
    const chain = new AuditChain({ algorithm: 'SHA-256', companyId: 'c1' });
    await chain.append({
      id: 'e0',
      actorType: 'user',
      actorId: 'u1',
      action: 'a',
      entityType: 't',
    });
    await chain.append({
      id: 'e1',
      actorType: 'user',
      actorId: 'u1',
      action: 'b',
      entityType: 't',
    });
    const proof = await chain.generateProof(0);
    expect(proof).not.toBeNull();
    const tampered = { ...proof!, rootHash: 'ff'.repeat(32) };
    const valid = await verifyMerkleProof(tampered);
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Default config tests
// ---------------------------------------------------------------------------
describe('DefaultConfig', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_AUDIT_CONFIG.algorithm).toBe('SHA-256');
    expect(DEFAULT_AUDIT_CONFIG.companyId).toBe('');
  });
});
