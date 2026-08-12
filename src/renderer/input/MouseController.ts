export interface MouseCallbacks {
  onDown(x: number, y: number): void
  onMove(x: number, y: number, dx: number, dy: number, dt: number): void
  onUp(): void
  /** 快速按下抬起且位移极小（<8px、<400ms）视为点击，用于封面拾取 */
  onClick(x: number, y: number): void
}

/** 指针拖拽封装（Pointer Events + pointer capture），附带点击检测。 */
export class MouseController {
  callbacks: MouseCallbacks = {
    onDown: () => {},
    onMove: () => {},
    onUp: () => {},
    onClick: () => {},
  }

  private target: HTMLElement | null = null
  private down = false
  private lastX = 0
  private lastY = 0
  private lastT = 0
  private downX = 0
  private downY = 0
  private downT = 0

  attach(target: HTMLElement): void {
    this.target = target
    target.addEventListener('pointerdown', this.onPointerDown)
    target.addEventListener('pointermove', this.onPointerMove)
    target.addEventListener('pointerup', this.onPointerUp)
    target.addEventListener('pointercancel', this.onPointerCancel)
    window.addEventListener('blur', this.onBlur)
  }

  private onBlur = (): void => {
    this.endDrag(null)
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    this.down = true
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.lastT = performance.now()
    this.downX = e.clientX
    this.downY = e.clientY
    this.downT = this.lastT
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

  private onPointerUp = (e: PointerEvent): void => {
    this.endDrag(e)
  }

  private onPointerCancel = (): void => {
    // 取消（系统接管指针）不算点击
    this.endDrag(null)
  }

  private endDrag(e: PointerEvent | null): void {
    if (!this.down) return
    this.down = false
    this.target?.classList.remove('dragging')
    this.callbacks.onUp()
    // 点击判定：位移 < 8px 且按下到抬起 < 400ms
    if (e) {
      const dist = Math.hypot(e.clientX - this.downX, e.clientY - this.downY)
      const dt = performance.now() - this.downT
      if (dist < 8 && dt < 400) {
        this.callbacks.onClick(e.clientX, e.clientY)
      }
    }
  }
}
