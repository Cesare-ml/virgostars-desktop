/**
 * Prevent stale asynchronous renderer completions from overwriting the latest UI.
 * The actual WebGL renderer/animation lifecycle belongs to astrological-charts.
 *
 * No astronomical operations or user data live in this helper.
 */
export class RenderGeneration {
  private generation = 0;
  private disposed = false;

  begin(): number | null {
    if (this.disposed) return null;
    return ++this.generation;
  }

  isCurrent(ticket: number): boolean {
    return !this.disposed && Number.isSafeInteger(ticket) && ticket > 0 && ticket === this.generation;
  }

  invalidate(): void {
    ++this.generation;
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }
}
