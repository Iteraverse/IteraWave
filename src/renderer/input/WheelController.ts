export interface WheelCallbacks {
  onStep(dir: 1 | -1): void
}

/**
 * 滚轮 → 步进。delta 累积到阈值才触发一步，并加时间节流，
 * 避免高精度滚轮/触控板一次事件翻多张。
 */
export class WheelController {
  callbacks: WheelCallbacks = { onStep: () => {} }

  private acc = 0
  private lastStep = 0
  private readonly threshold = 60
  private readonly minIntervalMs = 40

  attach(target: HTMLElement): void {
    target.addEventListener('wheel', this.onWheel, { passive: true })
  }

  private onWheel = (e: WheelEvent): void => {
    const dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0
    if (dir === 0) return
    // 反向滚动时清零旧方向残量，避免一次事件连续触发多步（方向短暂反了）
    if (Math.sign(this.acc) !== 0 && Math.sign(this.acc) !== dir) this.acc = 0
    this.acc += e.deltaY
    const now = performance.now()
    while (Math.abs(this.acc) >= this.threshold && now - this.lastStep >= this.minIntervalMs) {
      this.callbacks.onStep(dir as 1 | -1)
      this.acc -= dir * this.threshold
      this.lastStep = now
    }
  }
}
