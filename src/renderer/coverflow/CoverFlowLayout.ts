import type { VisualConfig } from '../config/VisualConfig.js'

/** 单个封面在场景中的空间状态（文档 §11 CoverTransform） */
export interface CoverTransform {
  albumIndex: number
  /** 相对当前滚动位置的偏移（浮点，可为负） */
  offset: number
  x: number
  y: number
  z: number
  /** 绕 Y 轴旋转（弧度；正 = 左缘朝相机转） */
  rotationY: number
  scale: number
  brightness: number
  opacity: number
}

/** 专注模式布局状态：聚焦索引 + 过渡进度（0..1） */
export interface FocusState {
  index: number
  t: number
}

/**
 * Cover Flow 空间布局数学（文档 §13-14, §18）：
 * x = offset * spacing
 * scale = 1 - smoothstep(0, 5, d) * 0.35
 * z = -pow(d, 1.5) * depth
 * opacity = 1 - smoothstep(0.5, 6, d) * 0.65
 * brightness = 1 - smoothstep(0.2, 3, d) * 0.4
 * rotationY = -sign(offset) * easeOutCubic(min(|offset|,1)) * maxAngle
 *
 * 专注模式（focus）：主封面放大左移、其他封面退后变暗，normal ↔ focused 插值过渡。
 */
export class CoverFlowLayout {
  /** 可见范围：|offset| 超过此值的封面不绘制（opacity < 0.35） */
  static readonly VISIBLE_RADIUS = 7

  constructor(private readonly config: VisualConfig) {}

  compute(position: number, count: number, focus: FocusState | null = null): CoverTransform[] {
    const cfg = this.config
    const center = Math.round(position)
    const start = Math.max(0, center - CoverFlowLayout.VISIBLE_RADIUS)
    const end = Math.min(count - 1, center + CoverFlowLayout.VISIBLE_RADIUS)
    const out: CoverTransform[] = []

    for (let i = start; i <= end; i++) {
      const offset = i - position
      const d = Math.abs(offset)
      const scale = 1 - smoothstep(0, 5, d) * 0.35
      const z = -Math.pow(d, 1.5) * cfg.coverDepth
      const opacity = 1 - smoothstep(0.5, 6, d) * cfg.opacityFalloff
      const brightness = 1 - smoothstep(0.2, 3, d) * cfg.brightnessFalloff
      // 旋转方向：两侧朝外（Apple Cover Flow 像打开的书向两侧摊开）——
      // 右侧封面右缘（外侧）靠近观察者，左侧封面左缘靠近观察者
      const rotSign = offset > 0 ? 1 : offset < 0 ? -1 : 0
      const rotT = easeOutCubic(Math.min(Math.abs(offset), 1))
      // 角度随距离渐进（Apple 风格）：offset=1 → maxAngle，offset≥3 → 接近侧立
      const angleDeg = cfg.coverMaxAngle + (cfg.coverFarAngle - cfg.coverMaxAngle) * smoothstep(1, 3, d)
      const normal: CoverTransform = {
        albumIndex: i,
        offset,
        x: offset * cfg.coverSpacing,
        y: 0,
        z,
        rotationY: rotSign * rotT * degToRad(angleDeg),
        scale,
        brightness,
        opacity,
      }
      let t = normal
      if (focus && focus.t > 0.002) {
        // 错峰过渡：近的封面先动、远的跟进（波浪收拢/展开，避免所有封面同时开始同时结束的生硬感）
        const delay = Math.min(Math.abs(offset), 4) * 0.09
        const tt = clamp01((focus.t - delay) / Math.max(0.02, 1 - delay))
        const k = easeInOutCubic(tt)
        t = lerpTransform(normal, this.focusTransform(normal, focus.index), k)
      }
      out.push(t)
    }
    // 渲染顺序：远 → 近（后画的近封面正确遮挡远处的）
    out.sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset))
    return out
  }

  /**
   * 专注模式目标布局：主封面放大左移正对；
   * 其他封面收拢到主封面背后——x 靠向主封面（带方向偏移形成叠层）、z 分层加深、
   * 尺寸按 focusBackScale 缩小、明暗递减。
   */
  private focusTransform(n: CoverTransform, focusIndex: number): CoverTransform {
    const cfg = this.config
    const focusX = -cfg.focusOffsetX * cfg.coverSize
    if (n.albumIndex === focusIndex) {
      return {
        ...n,
        x: focusX,
        y: 0,
        z: 0,
        rotationY: 0,
        scale: cfg.focusScale,
        brightness: 1,
        opacity: 1,
      }
    }
    const d = Math.max(1, Math.abs(n.offset))
    const dir = Math.sign(n.offset) || 1
    return {
      ...n,
      x: focusX + dir * Math.min(d, 4) * cfg.focusGather * cfg.coverSize,
      y: 0,
      z: -cfg.focusDepth - Math.min(d, 4) * 45,
      rotationY: 0,
      scale: cfg.focusScale * cfg.focusBackScale * (1 - Math.min(d, 4) * 0.04),
      brightness: n.brightness * cfg.focusBackDim,
      opacity: n.opacity * cfg.focusBackDim,
    }
  }
}

function lerpTransform(a: CoverTransform, b: CoverTransform, k: number): CoverTransform {
  return {
    albumIndex: a.albumIndex,
    offset: a.offset,
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
    rotationY: a.rotationY + (b.rotationY - a.rotationY) * k,
    scale: a.scale + (b.scale - a.scale) * k,
    brightness: a.brightness + (b.brightness - a.brightness) * k,
    opacity: a.opacity + (b.opacity - a.opacity) * k,
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180
}
