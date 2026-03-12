import { describe, expect, it } from 'bun:test';
import {
  buildCapabilityDeclaration,
  createSignedDeclaration,
  verifyDeclaration,
} from './capability-declaration.js';
import { canonicalize, generateKeyPair, sha256, signData, verifySignature } from './ed25519.js';
import { buildIdentityManifest, createSignedIdentity, verifyIdentity } from './identity.js';

// ---------------------------------------------------------------------------
// Ed25519 primitives
// ---------------------------------------------------------------------------
describe('Ed25519', () => {
  it('should generate a valid key pair', () => {
    const kp = generateKeyPair();
    // DER-encoded keys include algorithm headers beyond raw 32-byte keys
    expect(kp.publicKey.length).toBeGreaterThan(0);
    expect(kp.privateKey.length).toBeGreaterThan(0);
    expect(kp.publicKey).toMatch(/^[0-9a-f]+$/);
    expect(kp.privateKey).toMatch(/^[0-9a-f]+$/);
  });

  it('should sign and verify data', () => {
    const kp = generateKeyPair();
    const data = 'hello world';
    const sig = signData(data, kp.privateKey);
    expect(sig).toMatch(/^[0-9a-f]+$/);
    expect(verifySignature(data, sig, kp.publicKey)).toBe(true);
  });

  it('should reject tampered data', () => {
    const kp = generateKeyPair();
    const sig = signData('original', kp.privateKey);
    expect(verifySignature('tampered', sig, kp.publicKey)).toBe(false);
  });

  it('should reject wrong key', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const sig = signData('data', kp1.privateKey);
    expect(verifySignature('data', sig, kp2.publicKey)).toBe(false);
  });

  it('should compute consistent SHA-256', () => {
    const h1 = sha256('test');
    const h2 = sha256('test');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('should produce different hashes for different inputs', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });
});

describe('canonicalize', () => {
  it('should produce deterministic output regardless of key order', () => {
    const a = canonicalize({ b: 2, a: 1 });
    const b = canonicalize({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('should produce JSON string', () => {
    const result = canonicalize({ name: 'test', value: 42 });
    expect(JSON.parse(result)).toEqual({ name: 'test', value: 42 });
  });
});

// ---------------------------------------------------------------------------
// Agent Identity Signing
// ---------------------------------------------------------------------------
describe('Agent Identity Signing', () => {
  it('should build an identity manifest', () => {
    const kp = generateKeyPair();
    const manifest = buildIdentityManifest({
      agentId: 'agent-1',
      companyId: 'company-1',
      name: 'CodeBot',
      role: 'engineer',
      publicKey: kp.publicKey,
    });
    expect(manifest.agentId).toBe('agent-1');
    expect(manifest.companyId).toBe('company-1');
    expect(manifest.name).toBe('CodeBot');
    expect(manifest.role).toBe('engineer');
    expect(manifest.publicKey).toBe(kp.publicKey);
    expect(manifest.version).toBe(1);
    expect(manifest.createdAt).toBeTruthy();
  });

  it('should create and verify a signed identity', () => {
    const kp = generateKeyPair();
    const manifest = buildIdentityManifest({
      agentId: 'agent-1',
      companyId: 'company-1',
      name: 'CodeBot',
      role: 'engineer',
      publicKey: kp.publicKey,
    });
    const signed = createSignedIdentity(manifest, kp.privateKey);

    expect(signed.payload).toEqual(manifest);
    expect(signed.signerKey).toBe(kp.publicKey);
    expect(signed.signature).toMatch(/^[0-9a-f]+$/);
    expect(signed.signedAt).toBeTruthy();

    const result = verifyIdentity(signed);
    expect(result.valid).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.error).toBeNull();
  });

  it('should detect tampered identity manifest', () => {
    const kp = generateKeyPair();
    const manifest = buildIdentityManifest({
      agentId: 'agent-1',
      companyId: 'company-1',
      name: 'CodeBot',
      role: 'engineer',
      publicKey: kp.publicKey,
    });
    const signed = createSignedIdentity(manifest, kp.privateKey);

    // Tamper with the name
    const tampered = {
      ...signed,
      payload: { ...signed.payload, name: 'EvilBot' },
    };
    const result = verifyIdentity(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid signature');
  });

  it('should reject mismatched signer key', () => {
    const kp = generateKeyPair();
    const kp2 = generateKeyPair();
    const manifest = buildIdentityManifest({
      agentId: 'agent-1',
      companyId: 'company-1',
      name: 'CodeBot',
      role: 'engineer',
      publicKey: kp.publicKey,
    });
    const signed = createSignedIdentity(manifest, kp.privateKey);

    // Change signer key to a different key
    const tampered = { ...signed, signerKey: kp2.publicKey };
    const result = verifyIdentity(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('does not match');
  });

  it('should support key rotation via version', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();

    const v1 = buildIdentityManifest({
      agentId: 'agent-1',
      companyId: 'company-1',
      name: 'CodeBot',
      role: 'engineer',
      publicKey: kp1.publicKey,
      version: 1,
    });
    const v2 = buildIdentityManifest({
      agentId: 'agent-1',
      companyId: 'company-1',
      name: 'CodeBot',
      role: 'engineer',
      publicKey: kp2.publicKey,
      version: 2,
    });

    const signed1 = createSignedIdentity(v1, kp1.privateKey);
    const signed2 = createSignedIdentity(v2, kp2.privateKey);

    expect(verifyIdentity(signed1).valid).toBe(true);
    expect(verifyIdentity(signed2).valid).toBe(true);
    expect(signed1.payload.version).toBe(1);
    expect(signed2.payload.version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Capability Declaration Signing
// ---------------------------------------------------------------------------
describe('Capability Declaration Signing', () => {
  it('should build a capability declaration', () => {
    const decl = buildCapabilityDeclaration({
      declarationId: 'decl-1',
      agentId: 'agent-1',
      companyId: 'company-1',
      capabilities: [
        { type: 'tool_invoke', toolId: 'checkout_issue' },
        { type: 'file_read', glob: '/data/**' },
      ],
      grantedBy: 'admin-1',
    });
    expect(decl.declarationId).toBe('decl-1');
    expect(decl.agentId).toBe('agent-1');
    expect(decl.capabilities).toHaveLength(2);
    expect(decl.version).toBe(1);
    expect(decl.expiresAt).toBeNull();
    expect(decl.grantedAt).toBeTruthy();
  });

  it('should create and verify a signed declaration', () => {
    const authority = generateKeyPair();
    const decl = buildCapabilityDeclaration({
      declarationId: 'decl-1',
      agentId: 'agent-1',
      companyId: 'company-1',
      capabilities: [{ type: 'tool_invoke', toolId: '*' }],
      grantedBy: 'admin-1',
    });
    const signed = createSignedDeclaration(decl, authority.privateKey, authority.publicKey);

    expect(signed.signerKey).toBe(authority.publicKey);
    expect(signed.signature).toMatch(/^[0-9a-f]+$/);

    const result = verifyDeclaration(signed);
    expect(result.valid).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.error).toBeNull();
  });

  it('should verify against a specific authority key', () => {
    const authority = generateKeyPair();
    const decl = buildCapabilityDeclaration({
      declarationId: 'decl-1',
      agentId: 'agent-1',
      companyId: 'company-1',
      capabilities: [{ type: 'net_connect', pattern: '*.github.com' }],
      grantedBy: 'admin-1',
    });
    const signed = createSignedDeclaration(decl, authority.privateKey, authority.publicKey);

    // Verify with correct authority key
    const result = verifyDeclaration(signed, authority.publicKey);
    expect(result.valid).toBe(true);

    // Verify with wrong authority key
    const wrongKey = generateKeyPair();
    const badResult = verifyDeclaration(signed, wrongKey.publicKey);
    expect(badResult.valid).toBe(false);
    expect(badResult.error).toContain('does not match');
  });

  it('should detect tampered capabilities', () => {
    const authority = generateKeyPair();
    const decl = buildCapabilityDeclaration({
      declarationId: 'decl-1',
      agentId: 'agent-1',
      companyId: 'company-1',
      capabilities: [{ type: 'tool_invoke', toolId: 'safe_tool' }],
      grantedBy: 'admin-1',
    });
    const signed = createSignedDeclaration(decl, authority.privateKey, authority.publicKey);

    // Tamper: escalate capabilities
    const tampered = {
      ...signed,
      payload: {
        ...signed.payload,
        capabilities: [{ type: 'shell_exec' as const, commands: ['rm -rf /'] }],
      },
    };
    const result = verifyDeclaration(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid signature');
  });

  it('should detect expired declarations', () => {
    const authority = generateKeyPair();
    const decl = buildCapabilityDeclaration({
      declarationId: 'decl-1',
      agentId: 'agent-1',
      companyId: 'company-1',
      capabilities: [{ type: 'tool_invoke', toolId: 'read_file' }],
      grantedBy: 'admin-1',
      expiresAt: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
    });
    const signed = createSignedDeclaration(decl, authority.privateKey, authority.publicKey);

    const result = verifyDeclaration(signed);
    expect(result.valid).toBe(true); // signature is valid
    expect(result.expired).toBe(true); // but expired
    expect(result.error).toContain('expired');
  });

  it('should accept non-expired declarations', () => {
    const authority = generateKeyPair();
    const decl = buildCapabilityDeclaration({
      declarationId: 'decl-1',
      agentId: 'agent-1',
      companyId: 'company-1',
      capabilities: [{ type: 'tool_invoke', toolId: 'read_file' }],
      grantedBy: 'admin-1',
      expiresAt: new Date(Date.now() + 86400000).toISOString(), // expires tomorrow
    });
    const signed = createSignedDeclaration(decl, authority.privateKey, authority.publicKey);

    const result = verifyDeclaration(signed);
    expect(result.valid).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.error).toBeNull();
  });

  it('should support versioned declarations', () => {
    const authority = generateKeyPair();

    const v1 = buildCapabilityDeclaration({
      declarationId: 'decl-1',
      agentId: 'agent-1',
      companyId: 'company-1',
      capabilities: [{ type: 'tool_invoke', toolId: 'read_file' }],
      grantedBy: 'admin-1',
      version: 1,
    });
    const v2 = buildCapabilityDeclaration({
      declarationId: 'decl-2',
      agentId: 'agent-1',
      companyId: 'company-1',
      capabilities: [
        { type: 'tool_invoke', toolId: 'read_file' },
        { type: 'tool_invoke', toolId: 'write_file' },
      ],
      grantedBy: 'admin-1',
      version: 2,
    });

    const signed1 = createSignedDeclaration(v1, authority.privateKey, authority.publicKey);
    const signed2 = createSignedDeclaration(v2, authority.privateKey, authority.publicKey);

    expect(verifyDeclaration(signed1).valid).toBe(true);
    expect(verifyDeclaration(signed2).valid).toBe(true);
    expect(signed1.payload.capabilities).toHaveLength(1);
    expect(signed2.payload.capabilities).toHaveLength(2);
  });
});
