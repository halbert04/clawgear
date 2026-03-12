/**
 * HMAC-SHA256 and nonce utilities for P2P authentication.
 */

import { createHmac, randomBytes } from 'node:crypto';

/** Generate a cryptographically random nonce (hex-encoded) */
export function generateNonce(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** Compute HMAC-SHA256 of data with a hex-encoded secret */
export function computeHmac(data: string, secretHex: string): string {
  const secret = Buffer.from(secretHex, 'hex');
  return createHmac('sha256', secret).update(data, 'utf-8').digest('hex');
}

/** Verify an HMAC-SHA256 against expected value (constant-time comparison) */
export function verifyHmac(data: string, expectedHmac: string, secretHex: string): boolean {
  const computed = computeHmac(data, secretHex);
  if (computed.length !== expectedHmac.length) return false;

  // Constant-time comparison to prevent timing attacks
  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ expectedHmac.charCodeAt(i);
  }
  return result === 0;
}

/** Generate a shared secret for peer registration */
export function generateSharedSecret(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
