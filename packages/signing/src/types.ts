/**
 * Types for Ed25519 identity and capability declaration signing.
 * Extends marketplace skill signing to agents and capability declarations.
 */

import type { Capability } from '@clawgear/shared/types';

/** Ed25519 key pair (hex-encoded DER format) */
export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/** A generic signed document envelope */
export interface SignedDocument<T> {
  /** The payload being signed */
  payload: T;
  /** Ed25519 signature of the canonical JSON payload (hex-encoded) */
  signature: string;
  /** Public key of the signer (hex-encoded) */
  signerKey: string;
  /** ISO-8601 timestamp of signing */
  signedAt: string;
}

/** Agent identity manifest — signed proof of agent identity */
export interface AgentIdentityManifest {
  /** Agent ID */
  agentId: string;
  /** Company ID the agent belongs to */
  companyId: string;
  /** Agent name */
  name: string;
  /** Agent role */
  role: string;
  /** Agent's Ed25519 public key (hex-encoded) */
  publicKey: string;
  /** Version of this identity (incremented on key rotation) */
  version: number;
  /** ISO-8601 timestamp of creation */
  createdAt: string;
}

/** Capability declaration — a versioned, signed set of capabilities for an agent */
export interface CapabilityDeclaration {
  /** Unique declaration ID */
  declarationId: string;
  /** Agent ID this declaration applies to */
  agentId: string;
  /** Company ID */
  companyId: string;
  /** Version of this declaration */
  version: number;
  /** The capabilities being declared */
  capabilities: Capability[];
  /** Who granted these capabilities */
  grantedBy: string;
  /** ISO-8601 timestamp of grant */
  grantedAt: string;
  /** Optional expiration (ISO-8601) */
  expiresAt: string | null;
}

/** Result of verifying a signed document */
export interface VerificationResult {
  /** Whether the signature is valid */
  valid: boolean;
  /** Whether the document has expired (for capability declarations) */
  expired: boolean;
  /** Error description if invalid */
  error: string | null;
}
