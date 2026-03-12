export {
  createDelegationToken,
  type DelegationRequest,
  type DelegationVerifyResult,
  hasPermission,
  verifyDelegationToken,
} from './delegation.js';
export {
  createChallenge,
  respondToChallenge,
  verifyResponse,
  verifyVerification,
} from './handshake.js';
export { computeHmac, generateNonce, generateSharedSecret, verifyHmac } from './hmac.js';
export type {
  AuthChallenge,
  AuthResponse,
  AuthResult,
  AuthVerification,
  DelegationToken,
  P2PAuthConfig,
  PeerIdentity,
} from './types.js';
export { DEFAULT_P2P_CONFIG } from './types.js';
