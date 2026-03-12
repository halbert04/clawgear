/**
 * Agent identity signing — Ed25519-signed proof of agent identity.
 * Agents can prove who they are via a signed identity manifest.
 */

import { canonicalize, signData, verifySignature } from './ed25519.js';
import type { AgentIdentityManifest, SignedDocument, VerificationResult } from './types.js';

/**
 * Create a signed agent identity manifest.
 * The manifest is signed by the agent's own private key, proving key ownership.
 */
export function createSignedIdentity(
  manifest: AgentIdentityManifest,
  privateKeyHex: string,
): SignedDocument<AgentIdentityManifest> {
  const canonical = canonicalize(manifest);
  const signature = signData(canonical, privateKeyHex);

  return {
    payload: manifest,
    signature,
    signerKey: manifest.publicKey,
    signedAt: new Date().toISOString(),
  };
}

/**
 * Verify a signed agent identity manifest.
 * Checks that:
 * 1. The signature is valid against the embedded public key
 * 2. The signerKey matches the payload's publicKey (self-signed)
 */
export function verifyIdentity(doc: SignedDocument<AgentIdentityManifest>): VerificationResult {
  // Signer key must match the identity's public key (self-signed)
  if (doc.signerKey !== doc.payload.publicKey) {
    return {
      valid: false,
      expired: false,
      error: 'Signer key does not match identity public key',
    };
  }

  const canonical = canonicalize(doc.payload);
  const valid = verifySignature(canonical, doc.signature, doc.signerKey);

  if (!valid) {
    return {
      valid: false,
      expired: false,
      error: 'Invalid signature — identity manifest may have been tampered with',
    };
  }

  return { valid: true, expired: false, error: null };
}

/**
 * Create an identity manifest for an agent.
 * Convenience function that builds the manifest object.
 */
export function buildIdentityManifest(params: {
  agentId: string;
  companyId: string;
  name: string;
  role: string;
  publicKey: string;
  version?: number;
}): AgentIdentityManifest {
  return {
    agentId: params.agentId,
    companyId: params.companyId,
    name: params.name,
    role: params.role,
    publicKey: params.publicKey,
    version: params.version ?? 1,
    createdAt: new Date().toISOString(),
  };
}
