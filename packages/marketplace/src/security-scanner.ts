import type { SecurityIssue, SecurityScanResult } from './types.js';

interface ScanPattern {
  regex: RegExp;
  severity: SecurityIssue['severity'];
  message: string;
}

const SCAN_PATTERNS: ScanPattern[] = [
  // Code execution
  {
    regex: /\beval\s*\(/,
    severity: 'critical',
    message: 'eval() usage detected — arbitrary code execution risk',
  },
  {
    regex: /\bnew\s+Function\s*\(/,
    severity: 'critical',
    message: 'new Function() usage — dynamic code generation risk',
  },
  {
    regex: /\bexecSync\b|\bexec\s*\(/,
    severity: 'critical',
    message: 'Process execution detected — shell injection risk',
  },
  {
    regex: /\bspawnSync\b|\bspawn\s*\(/,
    severity: 'critical',
    message: 'Process spawn detected — shell injection risk',
  },
  {
    regex: /child_process/,
    severity: 'critical',
    message: 'child_process import — arbitrary command execution',
  },

  // Network access to private IPs
  {
    regex: /127\.0\.0\.1|localhost/,
    severity: 'warning',
    message: 'Localhost reference — potential SSRF vector',
  },
  {
    regex: /192\.168\.\d+\.\d+/,
    severity: 'warning',
    message: 'Private IP reference — potential SSRF vector',
  },
  {
    regex: /10\.\d+\.\d+\.\d+/,
    severity: 'warning',
    message: 'Private IP reference — potential SSRF vector',
  },
  {
    regex: /169\.254\.169\.254/,
    severity: 'critical',
    message: 'Cloud metadata endpoint — credential theft risk',
  },

  // Environment/secret access
  {
    regex: /process\.env/,
    severity: 'warning',
    message: 'Environment variable access — potential secret exfiltration',
  },
  {
    regex: /\bfs\.\w*Sync\b/,
    severity: 'warning',
    message: 'Synchronous filesystem access — may block event loop',
  },
  {
    regex: /require\s*\(\s*['"]fs['"]/,
    severity: 'warning',
    message: 'Filesystem access — potential data exfiltration',
  },

  // Obfuscation
  {
    regex: /\\x[0-9a-f]{2}/i,
    severity: 'warning',
    message: 'Hex escape sequences — possible obfuscation',
  },
  {
    regex: /atob\s*\(|btoa\s*\(/,
    severity: 'info',
    message: 'Base64 encoding — verify not used for obfuscation',
  },
  {
    regex: /String\.fromCharCode/,
    severity: 'warning',
    message: 'String.fromCharCode — possible obfuscation technique',
  },
];

/**
 * Scan skill package files for malicious patterns.
 * @param files Map of filename -> file content
 */
export function scanSkillPackage(files: Map<string, string>): SecurityScanResult {
  const issues: SecurityIssue[] = [];

  for (const [filename, content] of files) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of SCAN_PATTERNS) {
        if (pattern.regex.test(line)) {
          issues.push({
            severity: pattern.severity,
            pattern: pattern.regex.source,
            file: filename,
            line: i + 1,
            message: pattern.message,
          });
        }
      }
    }
  }

  const hasCritical = issues.some((i) => i.severity === 'critical');
  return { passed: !hasCritical, issues };
}
