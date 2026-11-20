/** Repaints an already animated scene without creating or retaining it. */
export class StarAnimationRepaint {
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private readonly schedule: (tick: () => void) => ReturnType<typeof setInterval>;
  private readonly cancel: (timer: ReturnType<typeof setInterval>) => void;
  private readonly visible: () => boolean;
  private readonly repaint: () => void;

  constructor(
    schedule: (tick: () => void) => ReturnType<typeof setInterval>,
    cancel: (timer: ReturnType<typeof setInterval>) => void,
    visible: () => boolean,
    repaint: () => void,
  ) {
    this.schedule = schedule;
    this.cancel = cancel;
    this.visible = visible;
    this.repaint = repaint;
  }

  start(): void {
    if (this.timer !== null) return;
    const generation = ++this.generation;
    this.timer = this.schedule(() => {
      if (this.timer !== null && generation === this.generation && this.visible()) this.repaint();
    });
  }

  stop(): void {
    if (this.timer === null) return;
    this.cancel(this.timer);
    this.timer = null;
    ++this.generation;
  }
}
