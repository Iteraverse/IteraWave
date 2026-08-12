import type { AlbumPalette, RGB } from '../album/Album.js'
import type { VisualConfig } from '../config/VisualConfig.js'

/**
 * GPU Ambient Color Field 的 CPU 侧状态（文档 §4-§9/§39/§40）：
 * - 8 个 ColorBlob，双频 sin/cos 组合运动（周期 15-60s 各不相同，近似非周期）
 * - 每帧把 blob 位置/半径/强度/颜色写入 uniform（轻量 CPU 计算，渲染在 GPU）
 * - Palette 过渡（§39）：切专辑时旧色块向新色块错峰溶解（不是整体渐变）
 * - Velocity Response（§40）：封面流速度轻微放大背景运动幅度
 * - 颜色安全（§38）：降饱和 × ambientSaturation、降亮度 × ambientBrightness
 */

interface BlobState {
  baseX: number
  baseY: number
  radius: number
  phase: number
  s1: number
  s2: number
  amp1: number
  amp2: number
  /** palette 槽位：0 dominant 1 secondary 2 accent 3 dark 4 light 5 average */
  slot: number
}

/** 每帧上传 GPU 的 blob 数据（每 blob 8 floats：x,y,radius,intensity,r,g,b,pad） */
export interface AmbientFrame {
  blobCount: number
  data: Float32Array
}

const PALETTE_KEYS = ['dominant', 'secondary', 'accent', 'dark', 'light', 'average'] as const

function paletteColor(p: AlbumPalette, slot: number): RGB {
  return p[PALETTE_KEYS[slot % PALETTE_KEYS.length]]
}

function lerp3(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function smoothstep01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

export class AmbientField {
  private time = 0
  private blobs: BlobState[] = []
  private palettes: readonly AlbumPalette[]
  private currentIndex = -1
  private transT = 1 // 1 = 过渡完成
  private transFrom: AlbumPalette | null = null
  private frame: AmbientFrame

  constructor(
    private readonly config: VisualConfig,
    palettes: readonly AlbumPalette[],
  ) {
    this.palettes = palettes
    this.frame = {
      blobCount: config.ambientBlobCount,
      data: new Float32Array(config.ambientBlobCount * 8),
    }
    // Golden angle 散布 + 错峰周期（15~60s，§6）
    const n = config.ambientBlobCount
    for (let i = 0; i < n; i++) {
      const angle = i * 2.399963 + 1.7
      const dist = 0.16 + 0.3 * ((i * 7) % 10) / 10
      const period = 15 + ((i * 7.3 + 3.1) % 46) // 15~60s
      const period2 = 9 + ((i * 11.7 + 5.3) % 26) // 第二频率
      this.blobs.push({
        baseX: 0.5 + Math.cos(angle) * dist,
        baseY: 0.5 + Math.sin(angle) * dist * 0.85,
        radius: config.ambientBlobRadius * (0.8 + ((i * 13) % 7) / 10),
        phase: i * 1.91,
        s1: (Math.PI * 2) / period * config.ambientBlobSpeed,
        s2: (Math.PI * 2) / period2 * config.ambientBlobSpeed,
        amp1: 0.035 + ((i * 5) % 4) * 0.012,
        amp2: 0.02 + ((i * 3) % 5) * 0.008,
        slot: i % PALETTE_KEYS.length,
      })
    }
  }

  /** 当前专辑变化 → 启动 palette 过渡（§39：色块重新组织） */
  setCurrentIndex(index: number): void {
    if (index === this.currentIndex || index < 0 || index >= this.palettes.length) return
    if (this.currentIndex >= 0) this.transFrom = this.palettes[this.currentIndex]
    this.currentIndex = index
    this.transT = 0
  }

  /** 每帧推进：返回待上传的 blob uniform 数据 */
  update(dt: number, velocity: number): AmbientFrame {
    this.time += dt
    if (this.transT < 1) {
      this.transT = Math.min(1, this.transT + dt / Math.max(0.05, this.config.paletteTransitionDuration))
    }
    // §40：封面流速度 → 背景幅度（很轻）
    const resp = 1 + Math.min(Math.abs(velocity) * this.config.ambientVelocityResponse, 0.3)
    const to = this.palettes[this.currentIndex] ?? this.palettes[0]
    const from = this.transFrom ?? to
    const sat = this.config.ambientSaturation
    const bright = this.config.ambientBrightness
    const data = this.frame.data

    for (let i = 0; i < this.blobs.length; i++) {
      const b = this.blobs[i]
      const t = this.time
      // §5：sin/cos 双频组合（非直线运动、非周期）
      const x = b.baseX + Math.sin(t * b.s1 + b.phase) * b.amp1 + Math.sin(t * b.s2 * 1.37) * b.amp2
      const y = b.baseY + Math.cos(t * b.s1 * 0.83 + b.phase * 1.3) * b.amp1 * 0.9 + Math.cos(t * b.s2 * 1.19) * b.amp2

      // §39：旧色 → 新色错峰溶解（不同 blob 不同延迟，形成"重新组织"感）
      const delay = (i % 6) / 6 * 0.35
      const k = smoothstep01((this.transT - delay) / Math.max(0.01, 1 - delay))
      const col = lerp3(paletteColor(from, b.slot), paletteColor(to, b.slot), k)

      // §38：饱和度/亮度安全限制
      const gray = (col[0] + col[1] + col[2]) / 3
      const sc: RGB = [gray + (col[0] - gray) * sat, gray + (col[1] - gray) * sat, gray + (col[2] - gray) * sat]
      const bc: RGB = [sc[0] * bright, sc[1] * bright, sc[2] * bright]

      const o = i * 8
      data[o] = x
      data[o + 1] = y
      data[o + 2] = b.radius
      data[o + 3] = this.config.ambientIntensity * resp
      data[o + 4] = bc[0]
      data[o + 5] = bc[1]
      data[o + 6] = bc[2]
      data[o + 7] = 0
    }
    return this.frame
  }
}
