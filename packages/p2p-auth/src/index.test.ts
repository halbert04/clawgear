import { describe, expect, it } from 'bun:test';
import { createDelegationToken, hasPermission, verifyDelegationToken } from './delegation.js';
import {
  createChallenge,
  respondToChallenge,
  verifyResponse,
  verifyVerification,
} from './handshake.js';
import { computeHmac, generateNonce, generateSharedSecret, verifyHmac } from './hmac.js';
import { DEFAULT_P2P_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// HMAC utilities
// ---------------------------------------------------------------------------
describe('generateNonce', () => {
  it('should generate a 64-char hex string by default (32 bytes)', () => {
    const nonce = generateNonce();
    expect(nonce).toHaveLength(64);
    expect(nonce).toMatch(/^[0-9a-f]+$/);
  });

  it('should generate unique nonces', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });

  it('should support custom byte length', () => {
    const nonce = generateNonce(16);
    expect(nonce).toHaveLength(32);
  });
});

describe('generateSharedSecret', () => {
  it('should generate a 64-char hex secret', () => {
    const secret = generateSharedSecret();
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[0-9a-f]+$/);
  });
});

describe('computeHmac / verifyHmac', () => {
  it('should compute consistent HMAC', () => {
    const secret = generateSharedSecret();
    const h1 = computeHmac('data', secret);
    const h2 = computeHmac('data', secret);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('should produce different HMACs for different data', () => {
    const secret = generateSharedSecret();
    expect(computeHmac('a', secret)).not.toBe(computeHmac('b', secret));
  });

  it('should produce different HMACs for different secrets', () => {
    const s1 = generateSharedSecret();
    const s2 = generateSharedSecret();
    expect(computeHmac('data', s1)).not.toBe(computeHmac('data', s2));
  });

  it('should verify correct HMAC', () => {
    const secret = generateSharedSecret();
    const hmac = computeHmac('hello', secret);
    expect(verifyHmac('hello', hmac, secret)).toBe(true);
  });

  it('should reject incorrect HMAC', () => {
    const secret = generateSharedSecret();
    const hmac = computeHmac('hello', secret);
    expect(verifyHmac('tampered', hmac, secret)).toBe(false);
  });

  it('should reject wrong secret', () => {
    const s1 = generateSharedSecret();
    const s2 = generateSharedSecret();
    const hmac = computeHmac('data', s1);
    expect(verifyHmac('data', hmac, s2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Handshake protocol
// ---------------------------------------------------------------------------
describe('Mutual Authentication Handshake', () => {
  const secret = generateSharedSecret();

  it('should complete a full handshake successfully', () => {
    // Step 1: Challenger creates challenge
    const challenge = createChallenge('instance-A', secret);
    expect(challenge.nonce).toHaveLength(64);
    expect(challenge.challengerId).toBe('instance-A');
    expect(challenge.hmac).toHaveLength(64);

    // Step 2: Responder verifies challenge and responds
    const { response, result: respResult } = respondToChallenge(challenge, 'instance-B', secret);
    expect(respResult.authenticated).toBe(true);
    expect(respResult.peerId).toBe('instance-A');
    expect(response.originalNonce).toBe(challenge.nonce);
    expect(response.responderId).toBe('instance-B');

    // Step 3: Challenger verifies response
    const { verification, result: verResult } = verifyResponse(
      challenge,
      response,
      'instance-A',
      secret,
    );
    expect(verResult.authenticated).toBe(true);
    expect(verResult.peerId).toBe('instance-B');
    expect(verification).not.toBeNull();

    // Step 4: Responder verifies verification
    const finalResult = verifyVerification(verification!, response.responseNonce, secret);
    expect(finalResult.authenticated).toBe(true);
    expect(finalResult.peerId).toBe('instance-A');
  });

  it('should reject challenge with wrong secret', () => {
    const challenge = createChallenge('instance-A', secret);
    const wrongSecret = generateSharedSecret();

    const { result } = respondToChallenge(challenge, 'instance-B', wrongSecret);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('HMAC');
  });

  it('should reject expired challenge', () => {
    const challenge = createChallenge('instance-A', secret);
    // Set timestamp to far in the past
    const expiredChallenge = {
      ...challenge,
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      hmac: computeHmac(
        `${challenge.nonce}|${challenge.challengerId}|${new Date(Date.now() - 60_000).toISOString()}`,
        secret,
      ),
    };

    const { result } = respondToChallenge(expiredChallenge, 'instance-B', secret, 30_000);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('should reject response with mismatched nonce', () => {
    const challenge = createChallenge('instance-A', secret);
    const { response } = respondToChallenge(challenge, 'instance-B', secret);

    // Tamper with the original nonce in the response
    const tampered = { ...response, originalNonce: 'wrong_nonce' };

    const { result } = verifyResponse(challenge, tampered, 'instance-A', secret);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('nonce');
  });

  it('should reject response with wrong secret', () => {
    const challenge = createChallenge('instance-A', secret);
    const { response } = respondToChallenge(challenge, 'instance-B', secret);

    const wrongSecret = generateSharedSecret();
    const { result } = verifyResponse(challenge, response, 'instance-A', wrongSecret);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('HMAC');
  });

  it('should reject verification with wrong nonce', () => {
    const challenge = createChallenge('instance-A', secret);
    const { response } = respondToChallenge(challenge, 'instance-B', secret);
    const { verification } = verifyResponse(challenge, response, 'instance-A', secret);

    const result = verifyVerification(verification!, 'wrong_nonce', secret);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('nonce');
  });

  it('should reject verification with wrong secret', () => {
    const challenge = createChallenge('instance-A', secret);
    const { response } = respondToChallenge(challenge, 'instance-B', secret);
    const { verification } = verifyResponse(challenge, response, 'instance-A', secret);

    const wrongSecret = generateSharedSecret();
    const result = verifyVerification(verification!, response.responseNonce, wrongSecret);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('HMAC');
  });
});

// ---------------------------------------------------------------------------
// Delegation tokens
// ---------------------------------------------------------------------------
describe('Delegation Tokens', () => {
  const secret = generateSharedSecret();

  it('should create a valid delegation token', () => {
    const token = createDelegationToken(
      {
        grantorInstanceId: 'instance-A',
        delegateInstanceId: 'instance-B',
        agentId: 'agent-1',
        permissions: ['execute', 'query'],
      },
      secret,
    );

    expect(token.tokenId).toMatch(/^deleg_/);
    expect(token.grantorInstanceId).toBe('instance-A');
    expect(token.delegateInstanceId).toBe('instance-B');
    expect(token.agentId).toBe('agent-1');
    expect(token.permissions).toEqual(['execute', 'query']);
    expect(token.hmac).toHaveLength(64);
    expect(token.issuedAt).toBeTruthy();
    expect(token.expiresAt).toBeTruthy();
  });

  it('should verify a valid token', () => {
    const token = createDelegationToken(
      {
        grantorInstanceId: 'instance-A',
        delegateInstanceId: 'instance-B',
        agentId: 'agent-1',
        permissions: ['execute'],
      },
      secret,
    );

    const result = verifyDelegationToken(token, secret);
    expect(result.valid).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.error).toBeNull();
  });

  it('should reject tampered token', () => {
    const token = createDelegationToken(
      {
        grantorInstanceId: 'instance-A',
        delegateInstanceId: 'instance-B',
        agentId: 'agent-1',
        permissions: ['execute'],
      },
      secret,
    );

    // Tamper: escalate permissions
    const tampered = { ...token, permissions: ['execute', 'admin'] };
    const result = verifyDelegationToken(tampered, secret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('tampered');
  });

  it('should reject token with wrong secret', () => {
    const token = createDelegationToken(
      {
        grantorInstanceId: 'instance-A',
        delegateInstanceId: 'instance-B',
        agentId: 'agent-1',
        permissions: ['execute'],
      },
      secret,
    );

    const wrongSecret = generateSharedSecret();
    const result = verifyDelegationToken(token, wrongSecret);
    expect(result.valid).toBe(false);
  });

  it('should detect expired token', () => {
    const token = createDelegationToken(
      {
        grantorInstanceId: 'instance-A',
        delegateInstanceId: 'instance-B',
        agentId: 'agent-1',
        permissions: ['query'],
        ttlMs: -1000, // Already expired
      },
      secret,
    );

    const result = verifyDelegationToken(token, secret);
    expect(result.valid).toBe(true);
    expect(result.expired).toBe(true);
    expect(result.error).toContain('expired');
  });

  it('should check permissions correctly', () => {
    const token = createDelegationToken(
      {
        grantorInstanceId: 'instance-A',
        delegateInstanceId: 'instance-B',
        agentId: 'agent-1',
        permissions: ['execute', 'query'],
      },
      secret,
    );

    expect(hasPermission(token, 'execute')).toBe(true);
    expect(hasPermission(token, 'query')).toBe(true);
    expect(hasPermission(token, 'admin')).toBe(false);
  });

  it('should support wildcard permissions', () => {
    const token = createDelegationToken(
      {
        grantorInstanceId: 'instance-A',
        delegateInstanceId: 'instance-B',
        agentId: 'agent-1',
        permissions: ['*'],
      },
      secret,
    );

    expect(hasPermission(token, 'execute')).toBe(true);
    expect(hasPermission(token, 'admin')).toBe(true);
    expect(hasPermission(token, 'anything')).toBe(true);
  });

  it('should use custom TTL', () => {
    const token = createDelegationToken(
      {
        grantorInstanceId: 'instance-A',
        delegateInstanceId: 'instance-B',
        agentId: 'agent-1',
        permissions: ['execute'],
        ttlMs: 60_000,
      },
      secret,
    );

    const issued = new Date(token.issuedAt).getTime();
    const expires = new Date(token.expiresAt).getTime();
    expect(expires - issued).toBeCloseTo(60_000, -2);
  });
});

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------
describe('DEFAULT_P2P_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_P2P_CONFIG.instanceId).toBe('');
    expect(DEFAULT_P2P_CONFIG.challengeWindowMs).toBe(30_000);
    expect(DEFAULT_P2P_CONFIG.delegationTtlMs).toBe(3_600_000);
  });
});
