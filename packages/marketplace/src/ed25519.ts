import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';

export interface KeyPair {
  /** Hex-encoded public key */
  publicKey: string;
  /** Hex-encoded private key */
  privateKey: string;
}

/**
 * Generate a new Ed25519 key pair for skill signing.
 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKey: Buffer.from(publicKey).toString('hex'),
    privateKey: Buffer.from(privateKey).toString('hex'),
  };
}

/**
 * Sign data with an Ed25519 private key.
 * @returns Hex-encoded signature.
 */
export function signData(data: string, privateKeyHex: string): string {
  const privateKeyDer = Buffer.from(privateKeyHex, 'hex');
  const privateKey = {
    key: privateKeyDer,
    format: 'der' as const,
    type: 'pkcs8' as const,
  };
  const signature = sign(null, Buffer.from(data, 'utf-8'), privateKey);
  return signature.toString('hex');
}

/**
 * Verify an Ed25519 signature.
 */
export function verifySignature(data: string, signatureHex: string, publicKeyHex: string): boolean {
  const publicKeyDer = Buffer.from(publicKeyHex, 'hex');
  const publicKey = {
    key: publicKeyDer,
    format: 'der' as const,
    type: 'spki' as const,
  };
  const signature = Buffer.from(signatureHex, 'hex');
  return verify(null, Buffer.from(data, 'utf-8'), publicKey, signature);
}

/**
 * Compute SHA-256 hash of content.
 */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}
