/**
 * Epoch-based watchdog timer for WASM execution.
 * Enforces wall-clock time limits and can signal termination.
 */
export class Watchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startTime = 0;
  private triggered = false;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Start the watchdog timer.
   * @param callback Called when the epoch timeout is reached.
   */
  start(callback: () => void): void {
    this.startTime = performance.now();
    this.triggered = false;
    this.timer = setTimeout(() => {
      this.triggered = true;
      callback();
    }, this.timeoutMs);
  }

  /** Stop the watchdog timer */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Get elapsed time in ms since start */
  elapsed(): number {
    if (this.startTime === 0) return 0;
    return performance.now() - this.startTime;
  }

  /** Check if the watchdog was triggered */
  wasTriggered(): boolean {
    return this.triggered;
  }

  /** Reset watchdog state */
  reset(): void {
    this.stop();
    this.startTime = 0;
    this.triggered = false;
  }
}
