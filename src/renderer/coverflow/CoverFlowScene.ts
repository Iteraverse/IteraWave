import type { VisualConfig } from '../config/VisualConfig.js'
import type { Renderer } from '../renderer/Renderer.js'
import { CoverFlowPhysics } from './CoverFlowPhysics.js'
import { CoverFlowLayout } from './CoverFlowLayout.js'
import type { CoverTransform } from './CoverFlowLayout.js'
import { CoverFlowInteraction } from './CoverFlowInteraction.js'
import type { MouseController } from '../input/MouseController.js'
import type { WheelController } from '../input/WheelController.js'
import type { KeyboardController } from '../input/KeyboardController.js'

/**
 * Cover Flow 场景：物理 + 布局 + 交互的统一入口（文档 §44 coverflow/）。
 *
 * 专注模式（focus）：点击封面进入——主封面放大左移、其他封面退后变暗，
 * 右侧歌词占位 + 底部进度条（UI 由 onFocusChange 通知外部）。
 * - 进入/切换：点击封面（handleClick 拾取）
 * - 退出：Esc / 再次点击主封面 / 点击空白
 * - 专注模式中 ← → / 滚轮 切换聚焦专辑（physics jumpTo 平滑过渡）
 */
export class CoverFlowScene {
  readonly physics: CoverFlowPhysics
  items: CoverTransform[] = []

  /** 专注模式变化回调（index 为 null = 退出） */
  onFocusChange: ((index: number | null) => void) | null = null

  /** 窗口宽度（CSS 像素），专注模式主封面按左半屏中心对齐（resize 时更新） */
  windowWidth = window.innerWidth

  private readonly layout: CoverFlowLayout
  private readonly interaction: CoverFlowInteraction
  private focused = false
  /** 布局使用的聚焦索引（退出动画期间保留） */
  private focusIndex: number | null = null
  private focusT = 0
  private focusTarget = 0

  constructor(
    private readonly renderer: Renderer,
    count: number,
    private readonly config: VisualConfig,
  ) {
    this.physics = new CoverFlowPhysics(config, 0, count - 1)
    this.layout = new CoverFlowLayout(config)
    this.interaction = new CoverFlowInteraction(this.physics, config)
  }

  attach(
    canvas: HTMLCanvasElement,
    mouse: MouseController,
    wheel: WheelController,
    keyboard: KeyboardController,
  ): void {
    this.interaction.attach(canvas, mouse, wheel, keyboard)
    this.interaction.onClick = (x, y) => this.handleClick(x, y)

    // 专注模式：滚轮/←→ 切换聚焦专辑；普通模式：翻页
    const origStep = wheel.callbacks.onStep
    wheel.callbacks.onStep = (dir) => {
      if (this.focused) this.setFocused(this.clampFocus(this.focusIndex! + dir))
      else origStep(dir)
    }
    const origLeft = keyboard.callbacks.onLeft
    keyboard.callbacks.onLeft = () => {
      if (this.focused) this.setFocused(this.clampFocus(this.focusIndex! - 1))
      else origLeft()
    }
    const origRight = keyboard.callbacks.onRight
    keyboard.callbacks.onRight = () => {
      if (this.focused) this.setFocused(this.clampFocus(this.focusIndex! + 1))
      else origRight()
    }
    keyboard.callbacks.onExit = () => this.setFocused(null)
  }

  /** 当前聚焦索引（null = 非专注模式） */
  get focusedIndex(): number | null {
    return this.focused ? this.focusIndex : null
  }

  /** 进入/切换/退出专注模式。切换聚焦专辑时保留过渡动画。 */
  setFocused(index: number | null): void {
    if (this.focused && index !== null) {
      if (index === this.focusIndex) return
      this.focusIndex = index
      this.physics.jumpTo(index)
      this.onFocusChange?.(index)
      return
    }
    if (index === null && !this.focused) return
    this.focused = index !== null
    if (index !== null) {
      this.focusIndex = index
      this.physics.jumpTo(index)
    }
    this.focusTarget = index !== null ? 1 : 0
    // 专注模式禁用拖拽（点击拾取仍生效）
    this.interaction.dragEnabled = index === null
    this.onFocusChange?.(index)
  }

  /** 点击拾取：命中封面 → 聚焦；专注模式点击主封面/空白 → 退出 */
  handleClick(x: number, y: number): void {
    const hit = this.renderer.hitTest(this.items, x, y, window.innerWidth, window.innerHeight)
    if (this.focused) {
      if (hit === null || hit === this.focusIndex) this.setFocused(null)
      else this.setFocused(hit)
    } else if (hit !== null) {
      this.setFocused(hit)
    }
  }

  update(dt: number): void {
    this.physics.update(dt)
    // focus 过渡动画（指数趋近，速度由配置控制）
    this.focusT += (this.focusTarget - this.focusT) * Math.min(1, dt * this.config.focusTransitionSpeed)
    if (!this.focused && this.focusT < 0.01) this.focusIndex = null
    const focus = this.focusIndex !== null ? { index: this.focusIndex, t: this.focusT } : null
    this.items = this.layout.compute(this.physics.position, this.physics.max + 1, focus, this.windowWidth)
  }

  get position(): number {
    return this.physics.position
  }

  private clampFocus(i: number): number {
    return Math.max(this.physics.min, Math.min(this.physics.max, i))
  }
}
