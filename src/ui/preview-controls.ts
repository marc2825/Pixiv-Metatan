export function previewPosition(anchor: { left: number; right: number; top: number; bottom: number }, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const gap = 12, margin = 8;
  const rightSpace = viewportWidth - anchor.right - gap - margin;
  const leftSpace = anchor.left - gap - margin;
  let left = rightSpace >= width || rightSpace >= leftSpace ? anchor.right + gap : anchor.left - width - gap;
  left = Math.max(margin, Math.min(left, viewportWidth - width - margin));
  const top = Math.max(margin, Math.min(anchor.top, viewportHeight - height - margin));
  return { left, top };
}

/** Accumulate small trackpad deltas; require a new gesture after momentum stops. */
export class PageWheel {
  private total = 0;
  private last = -Infinity;
  private switched = -Infinity;
  private consumed = false;
  reset() { this.total = 0; this.last = this.switched = -Infinity; this.consumed = false; }
  step(delta: number, mode: number, now: number): -1 | 0 | 1 {
    if (!Number.isFinite(delta) || delta === 0) return 0;
    const value = delta * (mode === 1 ? 16 : mode === 2 ? 400 : 1);
    const idle = now - this.last > 180;
    const reversed = this.total !== 0 && Math.sign(value) !== Math.sign(this.total);
    if (idle || reversed) { this.total = 0; this.consumed = false; }
    this.last = now;
    this.total += value;
    if (this.consumed || now - this.switched < 350 || Math.abs(this.total) < 80) return 0;
    this.consumed = true; this.switched = now;
    return this.total > 0 ? 1 : -1;
  }
}
