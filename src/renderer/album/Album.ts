/** 线性 RGB 颜色（各通道 0..1） */
export type RGB = [number, number, number]

/** 专辑调色板（文档 §2/§3：预计算，驱动环境背景） */
export interface AlbumPalette {
  dominant: RGB
  secondary: RGB
  accent: RGB
  dark: RGB
  light: RGB
  average: RGB
  /** 主色置信度 0..1（dominant 簇权重占比） */
  confidence: number
}

/** 一张专辑的不可变数据。Phase 1 封面由程序生成（canvas），后续 Phase 可替换为真实图片源。 */
export interface Album {
  readonly id: number
  readonly title: string
  readonly artist: string
  readonly year: number
  /** 512x512 封面画布（应用启动时一次性转为 ImageBitmap 上传 GPU） */
  readonly canvas: HTMLCanvasElement
  /** 封面主色调色板（AlbumColorAnalyzer 提取，驱动 Ambient 背景） */
  readonly palette: AlbumPalette
}
