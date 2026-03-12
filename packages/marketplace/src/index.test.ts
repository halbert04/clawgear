import { describe, expect, it } from 'bun:test';
import { generateKeyPair, sha256, signData, verifySignature } from './ed25519.js';
import { preparePublish, verifySkillIntegrity } from './publisher.js';
import { scanSkillPackage } from './security-scanner.js';

// ---------------------------------------------------------------------------
// Ed25519 signing tests
// ---------------------------------------------------------------------------
describe('Ed25519', () => {
  it('should generate a key pair', () => {
    const keys = generateKeyPair();
    expect(keys.publicKey).toBeDefined();
    expect(keys.privateKey).toBeDefined();
    expect(keys.publicKey.length).toBeGreaterThan(0);
    expect(keys.privateKey.length).toBeGreaterThan(0);
    // Keys are hex-encoded DER format
    expect(keys.publicKey).toMatch(/^[0-9a-f]+$/);
    expect(keys.privateKey).toMatch(/^[0-9a-f]+$/);
  });

  it('should generate unique key pairs', () => {
    const keys1 = generateKeyPair();
    const keys2 = generateKeyPair();
    expect(keys1.publicKey).not.toBe(keys2.publicKey);
    expect(keys1.privateKey).not.toBe(keys2.privateKey);
  });

  it('should sign and verify data', () => {
    const keys = generateKeyPair();
    const data = 'hello world';
    const signature = signData(data, keys.privateKey);
    expect(signature).toBeDefined();
    expect(signature.length).toBeGreaterThan(0);

    const valid = verifySignature(data, signature, keys.publicKey);
    expect(valid).toBe(true);
  });

  it('should reject tampered data', () => {
    const keys = generateKeyPair();
    const data = 'original data';
    const signature = signData(data, keys.privateKey);

    const valid = verifySignature('tampered data', signature, keys.publicKey);
    expect(valid).toBe(false);
  });

  it('should reject signature from wrong key', () => {
    const keys1 = generateKeyPair();
    const keys2 = generateKeyPair();
    const data = 'test data';
    const signature = signData(data, keys1.privateKey);

    const valid = verifySignature(data, signature, keys2.publicKey);
    expect(valid).toBe(false);
  });

  it('should compute SHA-256 hashes', () => {
    const hash = sha256('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('should produce consistent hashes', () => {
    expect(sha256('test')).toBe(sha256('test'));
  });

  it('should produce different hashes for different inputs', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });
});

// ---------------------------------------------------------------------------
// Security scanner tests
// ---------------------------------------------------------------------------
describe('SecurityScanner', () => {
  it('should pass clean files', () => {
    const files = new Map([
      ['HAND.toml', 'name = "my-skill"\ndescription = "A safe skill"'],
      ['system-prompt.md', '# My Skill\nYou are a helpful assistant.'],
    ]);
    const result = scanSkillPackage(files);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect eval() usage', () => {
    const files = new Map([['src/index.ts', 'const result = eval("1+1");']]);
    const result = scanSkillPackage(files);
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.severity).toBe('critical');
    expect(result.issues[0]!.message).toContain('eval');
  });

  it('should detect new Function() usage', () => {
    const files = new Map([['src/index.ts', 'const fn = new Function("return 1");']]);
    const result = scanSkillPackage(files);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.severity === 'critical')).toBe(true);
  });

  it('should detect child_process import', () => {
    const files = new Map([['src/index.ts', 'import { exec } from "child_process";']]);
    const result = scanSkillPackage(files);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes('child_process'))).toBe(true);
  });

  it('should detect cloud metadata endpoint', () => {
    const files = new Map([['src/index.ts', 'fetch("http://169.254.169.254/latest/meta-data/")']]);
    const result = scanSkillPackage(files);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes('metadata'))).toBe(true);
  });

  it('should warn on process.env access but still pass', () => {
    const files = new Map([['src/index.ts', 'const key = process.env.API_KEY;']]);
    const result = scanSkillPackage(files);
    // Warnings don't cause failure, only critical issues do
    expect(result.passed).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]!.severity).toBe('warning');
  });

  it('should warn on private IP references', () => {
    const files = new Map([['src/config.ts', 'const url = "http://192.168.1.1/api";']]);
    const result = scanSkillPackage(files);
    expect(result.passed).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('should report correct file and line numbers', () => {
    const files = new Map([['src/index.ts', 'const a = 1;\nconst b = eval("2");\nconst c = 3;']]);
    const result = scanSkillPackage(files);
    expect(result.issues[0]!.file).toBe('src/index.ts');
    expect(result.issues[0]!.line).toBe(2);
  });

  it('should detect multiple issues across files', () => {
    const files = new Map([
      ['src/a.ts', 'eval("bad")'],
      ['src/b.ts', 'import { exec } from "child_process";'],
    ]);
    const result = scanSkillPackage(files);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Publisher tests
// ---------------------------------------------------------------------------
describe('Publisher', () => {
  const keys = generateKeyPair();

  const cleanFiles = new Map([
    ['HAND.toml', 'name = "test-skill"\ndescription = "A test skill"'],
    ['system-prompt.md', '# Test\nYou are a test assistant.'],
  ]);

  const manifest = {
    name: 'test-skill',
    version: '1.0.0',
    description: 'A test skill',
    author: 'tester',
    license: 'MIT',
    tags: ['test'],
    capabilities: ['chat'],
  };

  it('should prepare a skill for publishing', () => {
    const result = preparePublish({
      manifest,
      files: cleanFiles,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    expect(result.success).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.manifest!.checksum).toBeDefined();
    expect(result.signature).toBeDefined();
    expect(result.packageData).toBeDefined();
    expect(result.scanResult.passed).toBe(true);
  });

  it('should reject skills with critical security issues', () => {
    const dangerousFiles = new Map([
      ['HAND.toml', 'name = "bad-skill"'],
      ['src/index.ts', 'eval("malicious code")'],
    ]);

    const result = preparePublish({
      manifest,
      files: dangerousFiles,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Security scan failed');
    expect(result.scanResult.passed).toBe(false);
  });

  it('should produce verifiable signatures', () => {
    const result = preparePublish({
      manifest,
      files: cleanFiles,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    expect(result.success).toBe(true);

    const verification = verifySkillIntegrity(
      result.manifest!,
      result.signature!,
      keys.publicKey,
      result.packageData!,
    );

    expect(verification.valid).toBe(true);
    expect(verification.error).toBeUndefined();
  });

  it('should detect tampered manifests', () => {
    const result = preparePublish({
      manifest,
      files: cleanFiles,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    // Tamper with manifest
    const tampered = { ...result.manifest!, name: 'tampered-skill' };

    const verification = verifySkillIntegrity(
      tampered,
      result.signature!,
      keys.publicKey,
      result.packageData!,
    );

    expect(verification.valid).toBe(false);
    expect(verification.error).toContain('Invalid signature');
  });

  it('should detect tampered package data', () => {
    const result = preparePublish({
      manifest,
      files: cleanFiles,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    // Tamper with package data
    const tamperedData = Buffer.from('tampered content').toString('base64');

    const verification = verifySkillIntegrity(
      result.manifest!,
      result.signature!,
      keys.publicKey,
      tamperedData,
    );

    expect(verification.valid).toBe(false);
    expect(verification.error).toContain('Checksum mismatch');
  });

  it('should reject verification with wrong public key', () => {
    const result = preparePublish({
      manifest,
      files: cleanFiles,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    const otherKeys = generateKeyPair();

    const verification = verifySkillIntegrity(
      result.manifest!,
      result.signature!,
      otherKeys.publicKey,
      result.packageData!,
    );

    expect(verification.valid).toBe(false);
    expect(verification.error).toContain('Invalid signature');
  });

  it('should compute consistent checksums', () => {
    const result1 = preparePublish({
      manifest,
      files: cleanFiles,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });
    const result2 = preparePublish({
      manifest,
      files: cleanFiles,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    expect(result1.manifest!.checksum).toBe(result2.manifest!.checksum);
  });
});
