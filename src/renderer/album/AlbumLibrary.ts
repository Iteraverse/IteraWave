import type { Album } from './Album.js'
import { AlbumColorAnalyzer } from './AlbumColorAnalyzer.js'

/** 程序化封面图案类型 */
type PatternKind = 'rings' | 'waves' | 'mountains' | 'halo' | 'beams' | 'grid' | 'dots' | 'stripe'

interface CoverDrawOptions {
  hue: number
  neutral: boolean
  kind: PatternKind
  title: string
  artist: string
  year: number
  rng: () => number
}

const TITLES = [
  'Neon Horizon', 'Midnight Circuit', 'Glass Bloom', 'Slow Static',
  'Chromatic Drift', 'Golden Hour Ratio', 'Paper Moons', 'Silicon Sunset',
  'Deep Field', 'Polar Sequences', 'Terracotta', 'Ultraviolet',
  'Tidal Memory', 'Fog Machine', 'Night Orbit', 'Tokyo Slow',
  'Analog Heart', 'Sand & Syntax', 'Violet Hour', 'Winter Garden',
  'Comet Tail', 'Solar Winds', 'Echo Chamber', 'Blue Reverie',
]

const ARTISTS = [
  'Aurora Wave', 'The Analog Society', 'Vela', 'Mono Lake',
  'Petrichor', 'Halo Theory', 'Juniper', 'Gamma Ray',
  'Observatory', 'North Signal', 'Soil & Sun', 'Prism Club',
  'Meridian', 'Cloud Index', 'Celestial Body', 'Lazy River',
  'Tape Deck', 'Desert Code', 'Duskline', 'Greenhouse Effect',
  'Long Exposure', 'Helios', 'Canyon', 'Neon Tide',
]

/** 固定种子 PRNG，保证每次启动的演示库一致、可复现 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`
}

/** 估算封面平均亮度（0..1），决定文字用深色还是浅色 */
function backgroundLightness(hue: number, neutral: boolean): number {
  if (neutral) return 0.42
  // 基于主色相的感知亮度近似
  const h = ((hue % 360) + 360) % 360
  const l = 0.5 - 0.28 * Math.abs(Math.sin(((h - 45) * Math.PI) / 180))
  return Math.min(0.62, Math.max(0.24, l))
}

function drawPattern(
  ctx: CanvasRenderingContext2D,
  kind: PatternKind,
  color: string,
  rng: () => number,
): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 3

  switch (kind) {
    case 'rings': {
      ctx.globalAlpha = 0.22 + rng() * 0.12
      for (let r = 40; r <= 240; r += 34) {
        ctx.beginPath()
        ctx.arc(256, 216, r, 0, Math.PI * 2)
        ctx.stroke()
      }
      break
    }
    case 'waves': {
      ctx.globalAlpha = 0.24 + rng() * 0.12
      for (let i = 0; i < 5; i++) {
        const y = 140 + i * 40
        ctx.beginPath()
        for (let x = 0; x <= 512; x += 8) {
          const yy = y + Math.sin((x + i * 47) * 0.045) * 14
          if (x === 0) ctx.moveTo(x, yy)
          else ctx.lineTo(x, yy)
        }
        ctx.stroke()
      }
      break
    }
    case 'mountains': {
      ctx.globalAlpha = 0.28 + rng() * 0.1
      for (let i = 0; i < 3; i++) {
        const base = 300 - i * 46
        const apex = base - 120 - rng() * 60
        ctx.beginPath()
        ctx.moveTo(-20, base)
        ctx.lineTo(150 + i * 60, apex)
        ctx.lineTo(340 - i * 40, base - 30)
        ctx.lineTo(540, base)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    case 'halo': {
      const g = ctx.createRadialGradient(256, 200, 10, 256, 200, 230)
      g.addColorStop(0, color)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = 0.5 + rng() * 0.2
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 512, 512)
      break
    }
    case 'beams': {
      ctx.globalAlpha = 0.16 + rng() * 0.1
      for (let i = -2; i < 6; i++) {
        const x0 = i * 120
        ctx.beginPath()
        ctx.moveTo(x0, 0)
        ctx.lineTo(x0 + 70, 0)
        ctx.lineTo(x0 + 70 + 512, 512)
        ctx.lineTo(x0 + 512, 512)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    case 'grid': {
      ctx.globalAlpha = 0.12 + rng() * 0.08
      for (let x = 64; x < 512; x += 64) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, 512)
        ctx.stroke()
      }
      for (let y = 48; y < 512; y += 64) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(512, y)
        ctx.stroke()
      }
      break
    }
    case 'dots': {
      ctx.globalAlpha = 0.2 + rng() * 0.12
      for (let y = 80; y < 420; y += 40) {
        for (let x = 80; x < 512; x += 40) {
          ctx.beginPath()
          ctx.arc(x + (y % 80 === 0 ? 20 : 0), y, 6, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      break
    }
    case 'stripe': {
      ctx.globalAlpha = 0.18 + rng() * 0.12
      for (let x = 30; x < 512; x += 84) {
        ctx.fillRect(x, 0, 36, 512)
      }
      break
    }
  }
  ctx.restore()
}

function drawCover(canvas: HTMLCanvasElement, o: CoverDrawOptions): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  const rng = o.rng
  const sat = o.neutral ? 4 : 52 + rng() * 30
  const l1 = o.neutral ? 68 + rng() * 8 : 34 + rng() * 14
  const l2 = o.neutral ? 84 + rng() * 6 : 16 + rng() * 12
  const accentL = o.neutral ? 30 : 58 + rng() * 14

  // 背景渐变（上 → 下）
  const grad = ctx.createLinearGradient(0, 0, 0, 512)
  grad.addColorStop(0, hsl(o.hue, sat, l1))
  grad.addColorStop(1, hsl(o.hue, sat, l2))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 512, 512)

  // 图案（使用高亮 accent 色或白/黑，透明度受控）
  const accent = o.neutral ? 'rgba(20,22,26,0.5)' : hsl(o.hue, Math.min(90, sat + 28), accentL)
  drawPattern(ctx, o.kind, accent, rng)

  // 细边框，让封面在暗背景上立起来
  ctx.strokeStyle = 'rgba(0,0,0,0.38)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(0.75, 0.75, 510.5, 510.5)

  // 文字（底部区域）
  const textColor = backgroundLightness(o.hue, o.neutral) > 0.4 ? '#101216' : '#f2f3f5'
  ctx.fillStyle = textColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '600 42px "Segoe UI", system-ui, sans-serif'
  ctx.fillText(o.title, 256, 436, 460)
  const anyCtx = ctx as unknown as { letterSpacing: string }
  anyCtx.letterSpacing = '6px'
  ctx.font = '500 16px "Segoe UI", system-ui, sans-serif'
  ctx.fillText(o.artist.toUpperCase(), 256, 466, 460)
  anyCtx.letterSpacing = '0px'
  ctx.globalAlpha = 0.65
  ctx.font = '400 15px "Segoe UI", system-ui, sans-serif'
  ctx.fillText(String(o.year), 256, 492)
  ctx.globalAlpha = 1
}

const PATTERNS: PatternKind[] = ['rings', 'waves', 'mountains', 'halo', 'beams', 'grid', 'dots', 'stripe']

/** 内置演示专辑库：程序生成（文档 §数据来源：仅内置演示） */
export class AlbumLibrary {
  generateDemo(count: number): Album[] {    const rng = mulberry32(20260214)
    const albums: Album[] = []
    for (let i = 0; i < count; i++) {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 512
      const neutral = i % 6 === 3
      const hue = Math.round((i * 137.508 + (rng() * 26 - 13) + 360) % 360)
      const kind = PATTERNS[Math.floor(rng() * PATTERNS.length)]
      const title = TITLES[i % TITLES.length]
      const artist = ARTISTS[i % ARTISTS.length]
      const year = 1979 + Math.floor(rng() * 46)
      drawCover(canvas, { hue, neutral, kind, title, artist, year, rng })
      // Phase 3：封面主色分析（驱动 Ambient 背景）
      const palette = AlbumColorAnalyzer.analyze(canvas)
      albums.push({ id: i, title, artist, year, canvas, palette })
    }
    return albums
  }

  /**
   * 从本地图片（covers/ 目录）构建专辑列表。
   * 图片按 cover-fit 居中裁剪到 512x512；文件名 "艺术家 - 标题" 自动拆分元数据。
   */
  async loadLocal(list: LocalCover[]): Promise<Album[]> {
    const albums: Album[] = []
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      try {
        const img = new Image()
        img.src = c.url
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = 512
        canvas.height = 512
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        const scale = Math.max(512 / img.naturalWidth, 512 / img.naturalHeight)
        const dw = img.naturalWidth * scale
        const dh = img.naturalHeight * scale
        ctx.drawImage(img, (512 - dw) / 2, (512 - dh) / 2, dw, dh)
        const palette = AlbumColorAnalyzer.analyze(canvas)
        const { title, artist } = splitLocalName(c.name)
        albums.push({ id: i, title, artist, year: c.year, canvas, palette })
      } catch (e) {
        console.warn('[albums] 跳过无法加载的封面:', c.name, String(e))
      }
    }
    return albums
  }
}

/** 本地文件名的元数据解析："艺术家 - 标题" → {artist, title}；否则整名作标题 */
function splitLocalName(name: string): { title: string; artist: string } {
  const parts = name.split(' - ')
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
  }
  return { artist: '本地图库', title: name.trim() }
}
