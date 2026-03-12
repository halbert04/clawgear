/**
 * Fuel-based instruction metering for WASM execution.
 * Tracks instruction count and enforces fuel limits.
 */
export class FuelMeter {
  private consumed = 0;
  private readonly limit: number;

  constructor(maxFuel: number) {
    this.limit = maxFuel;
  }

  /**
   * Consume fuel for executed instructions.
   * @returns true if fuel remains, false if exhausted.
   */
  consume(amount: number): boolean {
    this.consumed += amount;
    return this.consumed <= this.limit;
  }

  /** Get fuel consumed so far */
  getConsumed(): number {
    return this.consumed;
  }

  /** Get remaining fuel */
  getRemaining(): number {
    return Math.max(0, this.limit - this.consumed);
  }

  /** Check if fuel is exhausted */
  isExhausted(): boolean {
    return this.consumed >= this.limit;
  }

  /** Reset meter for reuse */
  reset(): void {
    this.consumed = 0;
  }
}
