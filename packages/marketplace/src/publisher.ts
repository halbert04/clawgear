import { sha256, signData, verifySignature } from './ed25519.js';
import { scanSkillPackage } from './security-scanner.js';
import type { SecurityScanResult, SkillManifest } from './types.js';

export interface PublishRequest {
  manifest: Omit<SkillManifest, 'checksum'>;
  /** Map of filename -> file content */
  files: Map<string, string>;
  /** Hex-encoded Ed25519 private key */
  privateKey: string;
  /** Hex-encoded Ed25519 public key */
  publicKey: string;
}

export interface PublishResult {
  success: boolean;
  manifest?: SkillManifest;
  signature?: string;
  packageData?: string;
  scanResult: SecurityScanResult;
  error?: string;
}

/**
 * Prepare a skill package for publishing.
 * Runs security scan, computes checksum, signs the manifest.
 */
export function preparePublish(request: PublishRequest): PublishResult {
  // 1. Security scan
  const scanResult = scanSkillPackage(request.files);
  if (!scanResult.passed) {
    return {
      success: false,
      scanResult,
      error: `Security scan failed: ${scanResult.issues.filter((i) => i.severity === 'critical').length} critical issues found`,
    };
  }

  // 2. Build package data (JSON-encoded file map)
  const packageContent = JSON.stringify(Object.fromEntries(request.files));
  const packageData = Buffer.from(packageContent).toString('base64');

  // 3. Compute checksum
  const checksum = sha256(packageContent);

  // 4. Build final manifest with checksum
  const manifest: SkillManifest = {
    ...request.manifest,
    checksum,
  };

  // 5. Sign the manifest
  const manifestJson = JSON.stringify(manifest, null, 0);
  const signature = signData(manifestJson, request.privateKey);

  return {
    success: true,
    manifest,
    signature,
    packageData,
    scanResult,
  };
}

/**
 * Verify a published skill's integrity.
 * Checks signature and checksum.
 */
export function verifySkillIntegrity(
  manifest: SkillManifest,
  signature: string,
  publisherKey: string,
  packageData: string,
): { valid: boolean; error?: string } {
  // 1. Verify signature
  const manifestJson = JSON.stringify(manifest, null, 0);
  const sigValid = verifySignature(manifestJson, signature, publisherKey);
  if (!sigValid) {
    return { valid: false, error: 'Invalid signature — manifest may have been tampered with' };
  }

  // 2. Verify checksum
  const packageContent = Buffer.from(packageData, 'base64').toString('utf-8');
  const computedChecksum = sha256(packageContent);
  if (computedChecksum !== manifest.checksum) {
    return { valid: false, error: 'Checksum mismatch — package content has been modified' };
  }

  return { valid: true };
}
