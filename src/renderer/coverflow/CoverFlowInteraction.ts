import type { VisualConfig } from '../config/VisualConfig.js'
import type { CoverFlowPhysics } from './CoverFlowPhysics.js'
import type { MouseController } from '../input/MouseController.js'
import type { WheelController } from '../input/WheelController.js'
import type { KeyboardController } from '../input/KeyboardController.js'

/**
 * 输入 → 物理 的映射层：
 * - 拖拽：指针位移 / spacing = 滚动位移（向右拖 = 浏览上一张）
 * - 滚轮：向下滚 = 下一张
 * - 键盘：← → / Home / End
 */
export class CoverFlowInteraction {
  private dragStartPosition = 0
  private dragStartX = 0

  /** 点击拾取回调（由 Scene 设置） */
  onClick: ((x: number, y: number) => void) | null = null
  /** 拖拽开关（专注模式禁用） */
  dragEnabled = true

  constructor(
    private readonly physics: CoverFlowPhysics,
    private readonly config: VisualConfig,
  ) {}

  attach(
    canvas: HTMLCanvasElement,
    mouse: MouseController,
    wheel: WheelController,
    keyboard: KeyboardController,
  ): void {
    mouse.callbacks = {
      onDown: (x) => {
        if (!this.dragEnabled) return
        this.dragStartPosition = this.physics.position
        this.dragStartX = x
      },
      onMove: (x, _y, _dx, _dy, dt) => {
        if (!this.dragEnabled) return
        const delta = (x - this.dragStartX) / this.config.coverSpacing
        this.physics.dragTo(this.dragStartPosition - delta, dt)
      },
      onUp: () => {
        if (this.dragEnabled) this.physics.dragEnd()
      },
      onClick: (x, y) => this.onClick?.(x, y),
    }

    wheel.callbacks = {
      onStep: (dir) => this.physics.step(dir),
    }

    keyboard.callbacks = {
      onLeft: () => this.physics.step(-1),
      onRight: () => this.physics.step(1),
      onHome: () => this.physics.jumpTo(this.physics.min),
      onEnd: () => this.physics.jumpTo(this.physics.max),
      onPlayPause: () => {},
      onFullscreen: () => {},
      onDebug: () => {},
      onExit: () => {},
    }

    mouse.attach(canvas)
    wheel.attach(canvas)
    keyboard.attach()
  }
}
