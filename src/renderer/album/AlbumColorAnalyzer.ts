import type { AlbumPalette, RGB } from './Album.js'

/**
 * 封面主色分析器（文档 §2/§3）：
 * 64x64 采样 → 去近黑/近白/低饱和噪声 → sRGB→OKLab（感知空间）→
 * 加权 K-Means 聚类（K=6，权重 = 饱和度 × 亮度 × 空间）→ Palette 提取。
 * 全部在线性/OKLab 空间计算，输出线性 RGB（与渲染管线一致，§37）。
 */

interface Lab {
  L: number
  a: number
  b: number
}

interface WeightedPixel extends Lab {
  weight: number
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/** sRGB → OKLab（Björn Ottosson） */
function srgbToOklab(r: number, g: number, b: number): Lab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  }
}

/** OKLab → 线性 sRGB */
function oklabToLinear(L: number, a: number, b: number): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const K = 6
const MAX_ITER = 8

export class AlbumColorAnalyzer {
  static analyze(canvas: HTMLCanvasElement, size = 64): AlbumPalette {
    // 缩小采样
    const tmp = document.createElement('canvas')
    tmp.width = size
    tmp.height = size
    const ctx = tmp.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas 2D unavailable')
    ctx.drawImage(canvas, 0, 0, size, size)
    const data = ctx.getImageData(0, 0, size, size).data

    // 像素加权 + OKLab 转换（§3.1 流程）
    const pixels: WeightedPixel[] = []
    let sumW = 0
    let avgR = 0
    let avgG = 0
    let avgB = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue // 去透明
      const r = srgbToLinear(data[i] / 255)
      const g = srgbToLinear(data[i + 1] / 255)
      const b = srgbToLinear(data[i + 2] / 255)
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      // 近黑/近白噪声降权（§3.1/§2）
      let w = 1
      if (lum < 0.06) w *= 0.12
      if (lum > 0.93) w *= 0.22
      // 空间权重：中心略高，不过度强调（§3.2）
      const idx = i / 4
      const px = idx % size
      const py = Math.floor(idx / size)
      const dx = (px - size / 2) / (size / 2)
      const dy = (py - size / 2) / (size / 2)
      w *= 1 - 0.15 * Math.sqrt(dx * dx + dy * dy)
      const lab = srgbToOklab(r, g, b)
      // 灰色降权（肤色等低饱和不主导，§2）
      if (Math.hypot(lab.a, lab.b) < 0.015) w *= 0.3
      // 中亮区域略高权
      w *= 1 - Math.abs(lab.L - 0.6) * 0.5
      if (w < 0.03) continue
      pixels.push({ L: lab.L, a: lab.a, b: lab.b, weight: w })
      sumW += w
      avgR += r * w
      avgG += g * w
      avgB += b * w
    }
    if (pixels.length === 0 || sumW <= 0) {
      const zero: RGB = [0, 0, 0]
      return { dominant: zero, secondary: zero, accent: zero, dark: zero, light: zero, average: zero, confidence: 0 }
    }

    // 加权 K-Means（OKLab 感知距离，§3.2）
    const centroids: Lab[] = initCentroids(pixels)
    const assign = new Uint16Array(pixels.length)
    for (let iter = 0; iter < MAX_ITER; iter++) {
      // 分配
      let moved = 0
      for (let i = 0; i < pixels.length; i++) {
        let best = 0
        let bestD = Infinity
        for (let k = 0; k < K; k++) {
          const d = dist(pixels[i], centroids[k])
          if (d < bestD) {
            bestD = d
            best = k
          }
        }
        if (assign[i] !== best) {
          assign[i] = best
          moved++
        }
      }
      if (iter > 0 && moved < pixels.length * 0.01) break
      // 更新质心（加权平均）
      const acc = new Float64Array(K * 3)
      const wSum = new Float64Array(K)
      for (let i = 0; i < pixels.length; i++) {
        const k = assign[i]
        acc[k * 3] += pixels[i].L * pixels[i].weight
        acc[k * 3 + 1] += pixels[i].a * pixels[i].weight
        acc[k * 3 + 2] += pixels[i].b * pixels[i].weight
        wSum[k] += pixels[i].weight
      }
      for (let k = 0; k < K; k++) {
        if (wSum[k] > 0) {
          centroids[k] = { L: acc[k * 3] / wSum[k], a: acc[k * 3 + 1] / wSum[k], b: acc[k * 3 + 2] / wSum[k] }
        }
      }
    }

    // 聚类统计（权重 / 彩度 / 亮度）
    interface Cluster {
      L: number
      a: number
      b: number
      weight: number
      chroma: number
    }
    const clusters: Cluster[] = []
    for (let k = 0; k < K; k++) {
      let w = 0
      let L = 0
      let a = 0
      let b = 0
      for (let i = 0; i < pixels.length; i++) {
        if (assign[i] === k) {
          w += pixels[i].weight
          L += pixels[i].L * pixels[i].weight
          a += pixels[i].a * pixels[i].weight
          b += pixels[i].b * pixels[i].weight
        }
      }
      if (w > 0) {
        clusters.push({ L: L / w, a: a / w, b: b / w, weight: w, chroma: Math.hypot(a / w, b / w) })
      }
    }
    clusters.sort((x, y) => y.weight - x.weight)

    const toRgb = (c: Cluster): RGB => {
      const rgb = oklabToLinear(c.L, c.a, c.b)
      return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])]
    }
    const dominant = clusters[0] ?? null
    const secondary = clusters[1] ?? dominant
    // accent：彩度最高的簇（权重占比足够）；dark/light：权重足够的极亮/极暗簇
    const minW = sumW * 0.05
    let accent = clusters.find((c) => c !== dominant && c.weight > minW && c.chroma > 0.04) ?? clusters[1] ?? dominant
    const dark = [...clusters].filter((c) => c.weight > minW * 0.6).sort((x, y) => x.L - y.L)[0] ?? dominant
    const light = [...clusters].filter((c) => c.weight > minW * 0.6).sort((x, y) => y.L - x.L)[0] ?? dominant

    return {
      dominant: dominant ? toRgb(dominant) : [0, 0, 0],
      secondary: secondary ? toRgb(secondary) : [0, 0, 0],
      accent: accent ? toRgb(accent) : [0, 0, 0],
      dark: toRgb(dark),
      light: toRgb(light),
      average: [clamp01(avgR / sumW), clamp01(avgG / sumW), clamp01(avgB / sumW)],
      confidence: dominant ? dominant.weight / sumW : 0,
    }
  }
}

function dist(p: Lab, c: Lab): number {
  const dL = p.L - c.L
  const da = p.a - c.a
  const db = p.b - c.b
  return dL * dL + da * da + db * db
}

/** 按权重分位数初始化质心（覆盖数据分布） */
function initCentroids(pixels: WeightedPixel[]): Lab[] {
  const n = pixels.length
  const out: Lab[] = []
  const step = n / K
  for (let k = 0; k < K; k++) {
    const idx = Math.min(n - 1, Math.floor(step * (k + 0.5)))
    out.push({ L: pixels[idx].L, a: pixels[idx].a, b: pixels[idx].b })
  }
  return out
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
