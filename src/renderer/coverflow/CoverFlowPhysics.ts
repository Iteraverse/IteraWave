import type { VisualConfig } from '../config/VisualConfig.js'

export type PhysicsMode = 'idle' | 'dragging' | 'inertia' | 'spring'

/**
 * Cover Flow 滚动物理（文档 §20-24）：
 * - dragging：位置直接跟随指针（1:1 映射），记录速度
 * - inertia：松手后惯性滑行，速度按摩擦系数衰减（帧率无关）
 * - spring：spring-damper 追目标索引（滚轮/键盘/吸附），a = (t-p)*k - v*c
 * - idle：静止
 */
export class CoverFlowPhysics {
  /** 当前滚动位置（浮点，0 = 第一张） */
  position = 0
  velocity = 0
  mode: PhysicsMode = 'idle'
  private target: number | null = null

  constructor(
    private readonly config: VisualConfig,
    readonly min: number,
    readonly max: number,
  ) {}

  get currentIndex(): number {
    return Math.round(this.position)
  }

  update(dt: number): void {
    switch (this.mode) {
      case 'dragging':
      case 'idle':
        return
      case 'inertia': {
        this.position += this.velocity * dt
        this.velocity *= Math.pow(this.config.scrollFriction, dt * 60)
        if (this.position <= this.min || this.position >= this.max) {
          this.position = clamp(this.position, this.min, this.max)
          this.velocity = 0
          this.startSpring(this.currentIndex)
        } else if (Math.abs(this.velocity) < this.config.inertiaStopVelocity) {
          this.startSpring(this.currentIndex)
        }
        return
      }
      case 'spring': {
        const t = this.target ?? this.currentIndex
        const a = (t - this.position) * this.config.springStiffness - this.velocity * this.config.springDamping
        this.velocity += a * dt
        this.position += this.velocity * dt
        if (Math.abs(t - this.position) < 0.001 && Math.abs(this.velocity) < 0.001) {
          this.position = t
          this.velocity = 0
          this.target = null
          this.mode = 'idle'
        }
        return
      }
    }
  }

  /** 拖拽中：位置跟随指针（像素位移 / spacing 换算），并记录瞬时速度 */
  dragTo(pos: number, dt: number): void {
    const prev = this.position
    this.position = clamp(pos, this.min, this.max)
    this.velocity = dt > 0 ? (this.position - prev) / dt : 0
    this.target = null
    this.mode = 'dragging'
  }

  /** 释放拖拽：速度快 → 惯性滑行；慢 → 直接弹簧吸附最近整数索引 */
  dragEnd(): void {
    if (this.mode !== 'dragging') return
    if (Math.abs(this.velocity) >= this.config.snapVelocityThreshold) {
      this.mode = 'inertia'
    } else {
      this.startSpring(this.currentIndex)
    }
  }

  /** 滚轮 / 键盘步进：朝目标方向 +1/-1（不瞬间跳转，由 spring 驱动） */
  step(dir: 1 | -1): void {
    const base = this.mode === 'spring' && this.target !== null ? this.target : this.currentIndex
    this.startSpring(base + dir)
  }

  /** 跳转到指定索引（Home / End） */
  jumpTo(index: number): void {
    this.startSpring(index)
  }

  private startSpring(index: number): void {
    this.target = clamp(index, this.min, this.max)
    this.mode = 'spring'
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
