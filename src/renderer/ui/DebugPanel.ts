import type { AlbumPalette, RGB } from '../album/Album.js'
import type { VisualConfig } from '../config/VisualConfig.js'

export interface DebugStats {
  fps: number
  frameMs: number
  index: number
  position: number
  velocity: number
  blobCount: number
  palette: AlbumPalette | null
}

interface SliderSpec {
  label: string
  get: () => number
  set: (v: number) => void
  min: number
  max: number
  step: number
}

/**
 * F12 调试面板（§46）：FPS/帧时间/状态 + 调色板色块 + 实时参数滑块。
 * 滑块直接修改 visualConfig / ambient 参数（引用传递，即时生效）。
 */
export class DebugPanel {
  private visible = false

  constructor(
    private readonly root: HTMLElement,
    private readonly statsEl: HTMLElement,
    private readonly paletteEl: HTMLElement,
    private readonly slidersEl: HTMLElement,
    private readonly config: VisualConfig,
  ) {
    this.buildSliders()
  }

  toggle(): void {
    this.visible = !this.visible
    this.root.hidden = !this.visible
  }

  update(stats: DebugStats): void {
    if (!this.visible) return
    this.statsEl.textContent = [
      `FPS        ${stats.fps.toFixed(0)}`,
      `Frame      ${stats.frameMs.toFixed(2)} ms`,
      `Album      ${stats.index}`,
      `Position   ${stats.position.toFixed(2)}`,
      `Velocity   ${stats.velocity.toFixed(2)}`,
      `Blobs      ${stats.blobCount}`,
    ].join('\n')
    this.paletteEl.replaceChildren()
    if (stats.palette) {
      const keys: ('dominant' | 'secondary' | 'accent' | 'dark' | 'light' | 'average')[] = [
        'dominant',
        'secondary',
        'accent',
        'dark',
        'light',
        'average',
      ]
      for (const k of keys) {
        const sw = document.createElement('div')
        sw.className = 'swatch'
        sw.style.background = rgbToCss(stats.palette[k])
        sw.title = k
        this.paletteEl.appendChild(sw)
      }
    }
  }

  private buildSliders(): void {
    const c = this.config
    const specs: SliderSpec[] = [
      { label: 'Cover Angle', get: () => c.coverMaxAngle, set: (v) => (c.coverMaxAngle = v), min: 20, max: 80, step: 1 },
      { label: 'Cover Spacing', get: () => c.coverSpacing, set: (v) => (c.coverSpacing = v), min: 180, max: 380, step: 5 },
      { label: 'Cover Depth', get: () => c.coverDepth, set: (v) => (c.coverDepth = v), min: 20, max: 120, step: 5 },
      { label: 'Spring Stiffness', get: () => c.springStiffness, set: (v) => (c.springStiffness = v), min: 60, max: 400, step: 10 },
      { label: 'Spring Damping', get: () => c.springDamping, set: (v) => (c.springDamping = v), min: 8, max: 60, step: 1 },
      { label: 'Ambient Intensity', get: () => c.ambientIntensity, set: (v) => (c.ambientIntensity = v), min: 0.1, max: 1.5, step: 0.05 },
      { label: 'Ambient Speed', get: () => c.ambientBlobSpeed, set: (v) => (c.ambientBlobSpeed = v), min: 0.2, max: 3, step: 0.1 },
      { label: 'Background Darkness', get: () => c.backgroundDarkness, set: (v) => (c.backgroundDarkness = v), min: 0.2, max: 0.95, step: 0.05 },
    ]
    for (const spec of specs) {
      const row = document.createElement('div')
      row.className = 'slider-row'
      const label = document.createElement('label')
      label.textContent = spec.label
      const input = document.createElement('input')
      input.type = 'range'
      input.min = String(spec.min)
      input.max = String(spec.max)
      input.step = String(spec.step)
      input.value = String(spec.get())
      input.addEventListener('input', () => spec.set(Number(input.value)))
      row.appendChild(label)
      row.appendChild(input)
      this.slidersEl.appendChild(row)
    }
  }
}

function rgbToCss(rgb: RGB): string {
  const to = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255)
  return `rgb(${to(rgb[0])},${to(rgb[1])},${to(rgb[2])})`
}
