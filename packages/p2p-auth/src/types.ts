/**
 * Types for P2P mutual authentication between ClawGear instances.
 * Uses HMAC-SHA256 nonce-based challenge-response protocol.
 */

/** Identity of a ClawGear peer instance */
export interface PeerIdentity {
  /** Unique instance ID */
  instanceId: string;
  /** Human-readable instance name */
  name: string;
  /** HMAC-SHA256 shared secret (hex-encoded) — known to both peers */
  sharedSecret: string;
  /** ISO-8601 timestamp when this peer was registered */
  registeredAt: string;
}

/** Challenge sent by the initiator to start mutual auth */
export interface AuthChallenge {
  /** Random nonce (hex-encoded, 32 bytes) */
  nonce: string;
  /** Instance ID of the challenger */
  challengerId: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** HMAC-SHA256(nonce + challengerId + timestamp, sharedSecret) */
  hmac: string;
}

/** Response to an auth challenge */
export interface AuthResponse {
  /** The original nonce from the challenge */
  originalNonce: string;
  /** A new nonce from the responder (for mutual verification) */
  responseNonce: string;
  /** Instance ID of the responder */
  responderId: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** HMAC-SHA256(originalNonce + responseNonce + responderId + timestamp, sharedSecret) */
  hmac: string;
}

/** Final verification confirming mutual authentication */
export interface AuthVerification {
  /** The response nonce being acknowledged */
  responseNonce: string;
  /** Instance ID of the verifier (original challenger) */
  verifierId: string;
  /** HMAC-SHA256(responseNonce + verifierId, sharedSecret) */
  hmac: string;
}

/** Result of a mutual authentication handshake */
export interface AuthResult {
  /** Whether authentication succeeded */
  authenticated: boolean;
  /** The authenticated peer's instance ID (null if failed) */
  peerId: string | null;
  /** Error message if authentication failed */
  error: string | null;
}

/** A delegation token for cross-instance agent operations */
export interface DelegationToken {
  /** Unique token ID */
  tokenId: string;
  /** Instance granting the delegation */
  grantorInstanceId: string;
  /** Instance receiving the delegation */
  delegateInstanceId: string;
  /** Agent ID being delegated */
  agentId: string;
  /** Permitted actions (e.g., 'execute', 'query', 'message') */
  permissions: string[];
  /** ISO-8601 issued timestamp */
  issuedAt: string;
  /** ISO-8601 expiration timestamp */
  expiresAt: string;
  /** HMAC-SHA256 of the token payload */
  hmac: string;
}

/** Configuration for the P2P auth module */
export interface P2PAuthConfig {
  /** This instance's identity */
  instanceId: string;
  /** Challenge validity window in ms (default: 30 seconds) */
  challengeWindowMs: number;
  /** Delegation token default TTL in ms (default: 1 hour) */
  delegationTtlMs: number;
}

export const DEFAULT_P2P_CONFIG: P2PAuthConfig = {
  instanceId: '',
  challengeWindowMs: 30_000,
  delegationTtlMs: 3_600_000,
};
