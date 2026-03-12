export {
  buildCapabilityDeclaration,
  createSignedDeclaration,
  verifyDeclaration,
} from './capability-declaration.js';
export { canonicalize, generateKeyPair, sha256, signData, verifySignature } from './ed25519.js';
export { buildIdentityManifest, createSignedIdentity, verifyIdentity } from './identity.js';
export type {
  AgentIdentityManifest,
  CapabilityDeclaration,
  KeyPair,
  SignedDocument,
  VerificationResult,
} from './types.js';
