import type { WasmCapability } from './types.js';

/**
 * Validates WASM host calls against declared capabilities.
 */
export class CapabilityValidator {
  private readonly capabilities: WasmCapability[];
  private deniedCount = 0;

  constructor(capabilities: WasmCapability[]) {
    this.capabilities = capabilities;
  }

  /** Check if filesystem read is allowed for the given path */
  canReadFs(path: string): boolean {
    return this.capabilities.some(
      (cap) => cap.type === 'fs_read' && cap.paths.some((p) => path.startsWith(p)),
    );
  }

  /** Check if filesystem write is allowed for the given path */
  canWriteFs(path: string): boolean {
    return this.capabilities.some(
      (cap) => cap.type === 'fs_write' && cap.paths.some((p) => path.startsWith(p)),
    );
  }

  /** Check if network connection to host is allowed */
  canConnect(host: string): boolean {
    return this.capabilities.some(
      (cap) =>
        cap.type === 'net_connect' &&
        cap.hosts.some((h) => {
          if (h.startsWith('*.')) {
            return host.endsWith(h.slice(1));
          }
          return host === h;
        }),
    );
  }

  /** Check if environment variable access is allowed */
  canReadEnv(key: string): boolean {
    return this.capabilities.some((cap) => cap.type === 'env_var' && cap.keys.includes(key));
  }

  /** Check if stdout is allowed */
  canStdout(): boolean {
    return this.capabilities.some((cap) => cap.type === 'stdout');
  }

  /** Check if stderr is allowed */
  canStderr(): boolean {
    return this.capabilities.some((cap) => cap.type === 'stderr');
  }

  /** Record a denied capability access */
  recordDenied(): void {
    this.deniedCount++;
  }

  /** Get total denied access count */
  getDeniedCount(): number {
    return this.deniedCount;
  }
}
