export interface MouseCallbacks {
  onDown(x: number, y: number): void
  onMove(x: number, y: number, dx: number, dy: number, dt: number): void
  onUp(): void
}

/** 指针拖拽封装（Pointer Events + pointer capture）。 */
export class MouseController {
  callbacks: MouseCallbacks = {
    onDown: () => {},
    onMove: () => {},
    onUp: () => {},
  }

  private target: HTMLElement | null = null
  private down = false
  private lastX = 0
  private lastY = 0
  private lastT = 0

  attach(target: HTMLElement): void {
    this.target = target
    target.addEventListener('pointerdown', this.onPointerDown)
    target.addEventListener('pointermove', this.onPointerMove)
    target.addEventListener('pointerup', this.onPointerUp)
    target.addEventListener('pointercancel', this.onPointerUp)
    window.addEventListener('blur', this.onBlur)
  }

  private onBlur = (): void => {
    this.endDrag()
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    this.down = true
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.lastT = performance.now()
    this.target?.setPointerCapture(e.pointerId)
    this.target?.classList.add('dragging')
    this.callbacks.onDown(e.clientX, e.clientY)
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.down) return
    const now = performance.now()
    const dt = Math.max((now - this.lastT) / 1000, 1e-4)
    this.callbacks.onMove(e.clientX, e.clientY, e.clientX - this.lastX, e.clientY - this.lastY, dt)
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.lastT = now
  }

  private onPointerUp = (): void => {
    this.endDrag()
  }

  private endDrag(): void {
    if (!this.down) return
    this.down = false
    this.target?.classList.remove('dragging')
    this.callbacks.onUp()
  }
}
