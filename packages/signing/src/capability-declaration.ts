/**
 * Capability declaration signing — versioned, signed capability grants.
 * An authority (admin/system) signs a set of capabilities for an agent.
 */

import { canonicalize, signData, verifySignature } from './ed25519.js';
import type { CapabilityDeclaration, SignedDocument, VerificationResult } from './types.js';

/**
 * Create a signed capability declaration.
 * The declaration is signed by the granting authority's private key.
 */
export function createSignedDeclaration(
  declaration: CapabilityDeclaration,
  authorityPrivateKeyHex: string,
  authorityPublicKeyHex: string,
): SignedDocument<CapabilityDeclaration> {
  const canonical = canonicalize(declaration);
  const signature = signData(canonical, authorityPrivateKeyHex);

  return {
    payload: declaration,
    signature,
    signerKey: authorityPublicKeyHex,
    signedAt: new Date().toISOString(),
  };
}

/**
 * Verify a signed capability declaration.
 * Checks that:
 * 1. The signature is valid against the signer's public key
 * 2. The declaration has not expired (if expiresAt is set)
 */
export function verifyDeclaration(
  doc: SignedDocument<CapabilityDeclaration>,
  authorityPublicKeyHex?: string,
): VerificationResult {
  // If an authority key is provided, verify it matches
  const expectedKey = authorityPublicKeyHex ?? doc.signerKey;
  if (expectedKey !== doc.signerKey) {
    return {
      valid: false,
      expired: false,
      error: 'Signer key does not match expected authority key',
    };
  }

  const canonical = canonicalize(doc.payload);
  const valid = verifySignature(canonical, doc.signature, doc.signerKey);

  if (!valid) {
    return {
      valid: false,
      expired: false,
      error: 'Invalid signature — capability declaration may have been tampered with',
    };
  }

  // Check expiration
  if (doc.payload.expiresAt) {
    const expired = new Date(doc.payload.expiresAt) < new Date();
    if (expired) {
      return {
        valid: true,
        expired: true,
        error: 'Capability declaration has expired',
      };
    }
  }

  return { valid: true, expired: false, error: null };
}

/**
 * Build a capability declaration.
 * Convenience function that constructs the declaration object.
 */
export function buildCapabilityDeclaration(params: {
  declarationId: string;
  agentId: string;
  companyId: string;
  capabilities: CapabilityDeclaration['capabilities'];
  grantedBy: string;
  version?: number;
  expiresAt?: string | null;
}): CapabilityDeclaration {
  return {
    declarationId: params.declarationId,
    agentId: params.agentId,
    companyId: params.companyId,
    version: params.version ?? 1,
    capabilities: params.capabilities,
    grantedBy: params.grantedBy,
    grantedAt: new Date().toISOString(),
    expiresAt: params.expiresAt ?? null,
  };
}
