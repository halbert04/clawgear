import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface SecretManagerConfig {
  /** Master encryption key (32 bytes hex or raw). Sourced from CLAWGEAR_MASTER_KEY env. */
  masterKey: Buffer;
}

/**
 * Manages encryption of company secrets at rest using AES-256-GCM.
 * Derives per-company keys via HKDF-like derivation (SHA256 of master + company ID).
 */
export class SecretManager {
  private masterKey: Buffer;

  constructor(config: SecretManagerConfig) {
    if (config.masterKey.length !== 32) {
      throw new Error('Master key must be exactly 32 bytes');
    }
    this.masterKey = config.masterKey;
  }

  /**
   * Create a SecretManager from the CLAWGEAR_MASTER_KEY env var.
   * Returns null if the env var is not set.
   */
  static fromEnv(): SecretManager | null {
    const keyHex = process.env.CLAWGEAR_MASTER_KEY;
    if (!keyHex) return null;
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== 32) {
      throw new Error('CLAWGEAR_MASTER_KEY must be a 64-character hex string (32 bytes)');
    }
    return new SecretManager({ masterKey: key });
  }

  /**
   * Encrypt a secret value for a specific company.
   * Returns: iv:ciphertext:authTag (all hex-encoded, colon-separated)
   */
  encrypt(companyId: string, plaintext: string): string {
    const key = this.deriveCompanyKey(companyId);
    const iv = randomBytes(12); // 96-bit IV for GCM
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
  }

  /**
   * Decrypt a secret value for a specific company.
   * Input format: iv:ciphertext:authTag (hex-encoded)
   */
  decrypt(companyId: string, encryptedValue: string): string {
    const parts = encryptedValue.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted value format');
    }

    const [ivHex, ciphertextHex, authTagHex] = parts;
    const key = this.deriveCompanyKey(companyId);
    const iv = Buffer.from(ivHex!, 'hex');
    const ciphertext = Buffer.from(ciphertextHex!, 'hex');
    const authTag = Buffer.from(authTagHex!, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /**
   * Generate an API key: returns { plaintext, hash }.
   * The plaintext is shown once; the hash (SHA-256) is stored.
   */
  generateApiKey(): { plaintext: string; hash: string } {
    const keyBytes = randomBytes(32);
    const plaintext = `cg_${keyBytes.toString('hex')}`;
    const hash = createHash('sha256').update(plaintext).digest('hex');
    return { plaintext, hash };
  }

  /**
   * Hash an API key for comparison against stored hashes.
   */
  hashApiKey(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  /**
   * Build regex patterns from known secret values for redaction.
   */
  buildRedactionPatterns(secrets: string[]): RegExp[] {
    return secrets
      .filter((s) => s.length >= 8) // Only redact secrets of reasonable length
      .map((s) => {
        const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped, 'g');
      });
  }

  /**
   * Derive a per-company encryption key using SHA-256(masterKey + companyId).
   */
  private deriveCompanyKey(companyId: string): Buffer {
    return createHash('sha256')
      .update(this.masterKey)
      .update(companyId)
      .update('company-secrets')
      .digest();
  }
}
