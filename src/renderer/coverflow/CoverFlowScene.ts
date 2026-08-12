import type { VisualConfig } from '../config/VisualConfig.js'
import type { Renderer } from '../renderer/Renderer.js'
import { CoverFlowPhysics } from './CoverFlowPhysics.js'
import { CoverFlowLayout } from './CoverFlowLayout.js'
import type { CoverTransform } from './CoverFlowLayout.js'
import { CoverFlowInteraction } from './CoverFlowInteraction.js'
import type { MouseController } from '../input/MouseController.js'
import type { WheelController } from '../input/WheelController.js'
import type { KeyboardController } from '../input/KeyboardController.js'

/** Cover Flow 场景：物理 + 布局 + 交互的统一入口（文档 §44 coverflow/）。 */
export class CoverFlowScene {
  readonly physics: CoverFlowPhysics
  items: CoverTransform[] = []

  private readonly layout: CoverFlowLayout
  private readonly interaction: CoverFlowInteraction

  constructor(
    private readonly renderer: Renderer,
    count: number,
    config: VisualConfig,
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
  }

  update(dt: number): void {
    this.physics.update(dt)
    this.items = this.layout.compute(this.physics.position, this.physics.max + 1)
  }

  get position(): number {
    return this.physics.position
  }
}
