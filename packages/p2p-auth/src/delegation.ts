/**
 * Cross-instance agent delegation tokens.
 * Allows one ClawGear instance to delegate agent operations to another.
 * Tokens are HMAC-signed and time-bounded.
 */

import { computeHmac, verifyHmac } from './hmac.js';
import type { DelegationToken } from './types.js';

/** Input for creating a delegation token */
export interface DelegationRequest {
  grantorInstanceId: string;
  delegateInstanceId: string;
  agentId: string;
  permissions: string[];
  ttlMs?: number;
}

/** Result of verifying a delegation token */
export interface DelegationVerifyResult {
  valid: boolean;
  expired: boolean;
  error: string | null;
}

/**
 * Create a delegation token for cross-instance agent operations.
 * The token is signed with the shared secret between the two instances.
 */
export function createDelegationToken(
  request: DelegationRequest,
  sharedSecret: string,
  ttlMs = 3_600_000,
): DelegationToken {
  const tokenId = `deleg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (request.ttlMs ?? ttlMs)).toISOString();

  const payload = [
    tokenId,
    request.grantorInstanceId,
    request.delegateInstanceId,
    request.agentId,
    request.permissions.sort().join(','),
    issuedAt,
    expiresAt,
  ].join('|');

  const hmac = computeHmac(payload, sharedSecret);

  return {
    tokenId,
    grantorInstanceId: request.grantorInstanceId,
    delegateInstanceId: request.delegateInstanceId,
    agentId: request.agentId,
    permissions: request.permissions,
    issuedAt,
    expiresAt,
    hmac,
  };
}

/**
 * Verify a delegation token's integrity and validity.
 * Checks HMAC signature and expiration.
 */
export function verifyDelegationToken(
  token: DelegationToken,
  sharedSecret: string,
): DelegationVerifyResult {
  // Reconstruct payload
  const payload = [
    token.tokenId,
    token.grantorInstanceId,
    token.delegateInstanceId,
    token.agentId,
    token.permissions.sort().join(','),
    token.issuedAt,
    token.expiresAt,
  ].join('|');

  // Verify HMAC
  if (!verifyHmac(payload, token.hmac, sharedSecret)) {
    return {
      valid: false,
      expired: false,
      error: 'Invalid token HMAC — token may have been tampered with',
    };
  }

  // Check expiration
  if (new Date(token.expiresAt) < new Date()) {
    return {
      valid: true,
      expired: true,
      error: 'Delegation token has expired',
    };
  }

  return { valid: true, expired: false, error: null };
}

/**
 * Check if a delegation token grants a specific permission.
 */
export function hasPermission(token: DelegationToken, permission: string): boolean {
  return token.permissions.includes(permission) || token.permissions.includes('*');
}
