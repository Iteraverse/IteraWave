import type { Album } from './Album.js'

/**
 * 专辑纹理分级缓存（文档 §32/§34）：
 * - 三档分辨率：full(512) / medium(256) / thumbnail(128)，分存三个 texture_2d_array
 * - 当前专辑附近用 full，稍远 medium，远处 thumbnail（tierForDistance）
 * - 启动时全量生成上传并生成 mipmap（演示数据量小；接真实图片后此处升级为 LRU 动态加载）
 * - layer 编码：layer = albumIndex * 3 + tier，shader 侧解码出所在档位与层内索引
 */
export type TextureTier = 0 | 1 | 2

export class AlbumTextureCache {
  static readonly TIER_COUNT = 3
  static readonly TIER_SIZES = [512, 256, 128] as const

  /** 距离 → 档位：|offset| < 1.5 用 full，< 3.5 用 medium，更远 thumbnail */
  static tierForDistance(d: number): TextureTier {
    return d < 1.5 ? 0 : d < 3.5 ? 1 : 2
  }

  /** 编码层号（供 instance 的 layer 字段与 shader 解码） */
  static layerFor(albumIndex: number, tier: TextureTier): number {
    return albumIndex * AlbumTextureCache.TIER_COUNT + tier
  }

  /** 生成三档 canvas 并上传为三个 texture array（各层尺寸=档位尺寸），随后生成完整 mipmap */
  static async createTieredTextures(
    device: GPUDevice,
    albums: readonly Album[],
  ): Promise<GPUTexture[]> {
    const sizes = AlbumTextureCache.TIER_SIZES
    const mipLevels = Math.log2(sizes[0]) + 1
    const textures: GPUTexture[] = []

    for (let t = 0; t < AlbumTextureCache.TIER_COUNT; t++) {
      const size = sizes[t]
      const texture = device.createTexture({
        size: [size, size, albums.length],
        dimension: '2d',
        format: 'rgba8unorm-srgb',
        // Chromium 的 copyExternalImageToTexture(ImageBitmap) 内部经 render pass 实现，
        // 目标纹理需要 RENDER_ATTACHMENT（即使不做 mipmap 也要保留）
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      for (let a = 0; a < albums.length; a++) {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D unavailable')
        ctx.drawImage(albums[a].canvas, 0, 0, size, size)
        const bitmap = await createImageBitmap(canvas)
        device.queue.copyExternalImageToTexture(
          { source: bitmap },
          { texture, origin: [0, 0, a] },
          [size, size],
        )
        bitmap.close()
      }
      textures.push(texture)
    }
    return textures
  }
}
