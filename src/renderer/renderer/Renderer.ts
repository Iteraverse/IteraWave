import type { VisualConfig } from '../config/VisualConfig.js'
import type { CoverTransform } from '../coverflow/CoverFlowLayout.js'
import type { AmbientFrame } from '../ambient/AmbientField.js'
import { AlbumTextureCache } from '../album/AlbumTextureCache.js'
import { COVER_SHADER, AMBIENT_SHADER, UPSCALE_SHADER } from './shaders.js'

const NEAR = 0.5
const FAR = 5000
/** 实例缓冲上限（同时可见封面 × 2：本体 + 模糊层；|offset|>7 不绘制） */
const MAX_INSTANCES = 32
/** 单个实例数据大小：mat4(64B) + layer(4B) + brightness(4B) + opacity(4B) + blur(4B) + isBlur(4B) */
const INSTANCE_STRIDE = 84

/**
 * WebGPU 渲染器（文档 §31/§36）：
 * Ambient 背景 pass（半分辨率 RT，§35）→ Upscale pass（+Vignette）→ 封面 pass（圆角）。
 * 透视投影在 vertex shader 中完成，真实 3D 空间而非 2D transform 假装。
 */
export class Renderer {
  private device!: GPUDevice
  private context!: GPUCanvasContext
  private format!: GPUTextureFormat

  private ambientPipeline!: GPURenderPipeline
  private upscalePipeline!: GPURenderPipeline
  private coverPipeline!: GPURenderPipeline
  private ambientBind!: GPUBindGroup
  private upscaleBind!: GPUBindGroup
  private coverBind!: GPUBindGroup
  private ambientUniform!: GPUBuffer
  private upscaleUniform!: GPUBuffer
  private projUniform!: GPUBuffer
  private bgRT: GPUTexture | null = null
  private bgRTView: GPUTextureView | null = null
  private rtSampler!: GPUSampler
  private quadVB!: GPUBuffer
  private indexBuffer!: GPUBuffer
  private instanceBuffers: GPUBuffer[] = []
  private instanceRing = 0

  private instanceData = new ArrayBuffer(MAX_INSTANCES * INSTANCE_STRIDE)
  private instanceF32 = new Float32Array(this.instanceData)
  private instanceU32 = new Uint32Array(this.instanceData)

  /** 最近一次 setSize 的透视投影矩阵（列主序，供 hitTest 使用） */
  private projView = new Float32Array(16)

  constructor(private readonly config: VisualConfig) {}

  async init(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    textures: readonly GPUTexture[],
  ): Promise<void> {
    this.device = device
    this.format = navigator.gpu.getPreferredCanvasFormat()

    const context = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) throw new Error('WebGPU canvas context unavailable')
    this.context = context
    this.context.configure({
      device,
      format: this.format,
      alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
    })

    // ---- 资源 ----
    const [coversFull, coversMed, coversThumb] = textures
    // 远处封面采样低一档纹理（小图线性放大 = 天然模糊，替代 mip bias）
    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      // 纹理无 mip 链：mipmapFilter 保持默认 'nearest'，否则无 mip 纹理采样返回 0
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })

    // Tint 要求 minBufferBindingSize 304（array<vec4f,16> 的 padding 规则）
    this.ambientUniform = device.createBuffer({ size: 304, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.upscaleUniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.rtSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    // proj(mat4) + cornerRadius + pad（vec3 对齐 16 → struct 96B）
    this.projUniform = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    for (let i = 0; i < 2; i++) {
      this.instanceBuffers.push(
        device.createBuffer({
          size: MAX_INSTANCES * INSTANCE_STRIDE,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        }),
      )
    }

    // 单位 quad：pos.xy + uv
    this.quadVB = device.createBuffer({ size: 16 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(
      this.quadVB,
      0,
      new Float32Array([
        -0.5, -0.5, 0, 1,
        0.5, -0.5, 1, 1,
        -0.5, 0.5, 0, 0,
        0.5, 0.5, 1, 0,
      ]),
    )
    this.indexBuffer = device.createBuffer({ size: 6 * 2, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(this.indexBuffer, 0, new Uint16Array([0, 1, 2, 1, 3, 2]))

    // ---- 管线 ----
    const ambientLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })
    const upscaleLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    })
    const coverLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    })

    const ambientModule = device.createShaderModule({ code: AMBIENT_SHADER })
    const upscaleModule = device.createShaderModule({ code: UPSCALE_SHADER })
    const coverModule = device.createShaderModule({ code: COVER_SHADER })

    this.ambientPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [ambientLayout] }),
      vertex: { module: ambientModule, entryPoint: 'vs' },
      fragment: { module: ambientModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm-srgb' }] },
      primitive: { topology: 'triangle-list' },
    })

    this.upscalePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [upscaleLayout] }),
      vertex: { module: upscaleModule, entryPoint: 'vs' },
      fragment: { module: upscaleModule, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    })

    this.coverPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [coverLayout] }),
      vertex: {
        module: coverModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
            ],
          },
          {
            arrayStride: INSTANCE_STRIDE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x4' },
              { shaderLocation: 3, offset: 16, format: 'float32x4' },
              { shaderLocation: 4, offset: 32, format: 'float32x4' },
              { shaderLocation: 5, offset: 48, format: 'float32x4' },
              { shaderLocation: 6, offset: 64, format: 'uint32' },
              { shaderLocation: 7, offset: 68, format: 'float32' },
              { shaderLocation: 8, offset: 72, format: 'float32' },
              { shaderLocation: 9, offset: 76, format: 'float32' },
              { shaderLocation: 10, offset: 80, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: coverModule,
        entryPoint: 'fs',
        targets: [
          {
            format: this.format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    })

    this.ambientBind = device.createBindGroup({
      layout: ambientLayout,
      entries: [{ binding: 0, resource: { buffer: this.ambientUniform } }],
    })
    this.coverBind = device.createBindGroup({
      layout: coverLayout,
      entries: [
        { binding: 0, resource: { buffer: this.projUniform } },
        { binding: 1, resource: coversFull.createView() },
        { binding: 2, resource: coversMed.createView() },
        { binding: 3, resource: coversThumb.createView() },
        { binding: 4, resource: sampler },
      ],
    })
    // upscaleBind 在 setSize（RT 创建后）构建
  }

  /** 更新 canvas 物理尺寸、透视投影与半分辨率背景 RT（窗口缩放 / DPR 变化时调用） */
  setSize(cssW: number, cssH: number, dpr: number): void {
    const canvas = this.context.canvas as HTMLCanvasElement
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }

    // 半分辨率背景 RT（§35）：高度模糊的背景无需全分辨率
    this.bgRT?.destroy()
    const rtW = Math.max(1, Math.floor(w / 2))
    const rtH = Math.max(1, Math.floor(h / 2))
    this.bgRT = this.device.createTexture({
      size: [rtW, rtH],
      format: 'rgba8unorm-srgb',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    this.bgRTView = this.bgRT.createView()
    this.upscaleBind = this.device.createBindGroup({
      layout: this.upscalePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.upscaleUniform } },
        { binding: 1, resource: this.bgRTView },
        { binding: 2, resource: this.rtSampler },
      ],
    })
    this.device.queue.writeBuffer(this.upscaleUniform, 0, new Float32Array([this.config.vignetteStrength, 0, 0, 0]))

    // 透视距离随窗口宽度动态调整（文档 §15: 800~1400px）
    const persp = clamp(
      cssW * this.config.coverPerspectiveFactor,
      this.config.coverPerspectiveMin,
      this.config.coverPerspectiveMax,
    )
    const f = (2 * persp) / Math.max(cssH, 1)
    const aspect = cssW / Math.max(cssH, 1)

    // 视图变换：相机在 z=+persp 看向 -z（场景 z 范围 0..-881，必须前移避免 w<=0 裁剪）
    // projView = proj * translate(0, 0, -persp)
    // col3 = proj * (0,0,-persp,1) = (0, 0, far*(near-persp)/(near-far), persp)
    const projView = new Float32Array(16)
    projView[0] = f / aspect
    projView[5] = f
    projView[10] = FAR / (NEAR - FAR)
    projView[11] = -1
    projView[14] = (FAR * (NEAR - persp)) / (NEAR - FAR)
    projView[15] = persp
    this.projView = projView
    // 封面 uniform：proj + 圆角半径（§45 集中管理）
    const coverUniform = new Float32Array(24)
    coverUniform.set(projView)
    coverUniform[16] = this.config.coverCornerRadius
    this.device.queue.writeBuffer(this.projUniform, 0, coverUniform)
  }

  /** 写入单个实例数据（模型矩阵 T*R*S 列主序 + 图层 + 亮度/透明度 + 模糊；isBlur = 模糊层） */
  private writeInstance(off: number, it: CoverTransform, layer: number, isBlur: boolean): void {
    const f32 = this.instanceF32
    const u32 = this.instanceU32
    const c = Math.cos(it.rotationY)
    const s = Math.sin(it.rotationY)
    // 模糊层 quad 比本体大 blur × blurOverflow（边缘晕开）
    const ss = this.config.coverSize * it.scale * (isBlur ? 1 + this.config.blurOverflow * it.blur : 1)
    f32[off + 0] = c * ss
    f32[off + 1] = 0
    f32[off + 2] = s * ss
    f32[off + 3] = 0
    f32[off + 4] = 0
    f32[off + 5] = ss
    f32[off + 6] = 0
    f32[off + 7] = 0
    f32[off + 8] = -s
    f32[off + 9] = 0
    f32[off + 10] = c
    f32[off + 11] = 0
    f32[off + 12] = it.x
    f32[off + 13] = it.y
    f32[off + 14] = it.z
    f32[off + 15] = 1
    u32[off + 16] = layer
    f32[off + 17] = it.brightness
    f32[off + 18] = it.opacity
    f32[off + 19] = it.blur
    f32[off + 20] = isBlur ? 1 : 0
  }

  /** 渲染一帧：Ambient 背景（半分辨率 RT）→ Upscale（+Vignette）→ 封面流（文档 §36/§35） */
  render(items: readonly CoverTransform[], ambient: AmbientFrame): void {
    // 每封面最多 2 实例：本体 + 模糊层（blur > 0 时）；items 已按远→近排序
    let total = 0
    const n = Math.min(items.length, Math.floor(MAX_INSTANCES / 2))
    for (let i = 0; i < n; i++) {
      const it = items[i]
      const tier = AlbumTextureCache.tierForDistance(Math.abs(it.offset))
      const layer = AlbumTextureCache.layerFor(it.albumIndex, tier)
      const off = total * (INSTANCE_STRIDE / 4)
      this.writeInstance(off, it, layer, false)
      total++
      if (it.blur > 0.01 && it.opacity > 0.001) {
        this.writeInstance(off + INSTANCE_STRIDE / 4, it, layer, true)
        total++
      }
    }

    const instanceBuffer = this.instanceBuffers[this.instanceRing]
    this.instanceRing ^= 1
    this.device.queue.writeBuffer(instanceBuffer, 0, this.instanceData, 0, total * INSTANCE_STRIDE)

    // Ambient blob uniform（§8：位置/半径/强度/颜色每帧由 CPU 更新）
    const au = new Float32Array(76)
    // blobCount 是 u32：必须用整数位模式写入（f32 写 8.0 会变成 ~1e9 导致 shader 循环爆炸）
    new Uint32Array(au.buffer)[0] = ambient.blobCount
    au.set(ambient.data.subarray(0, ambient.blobCount * 8), 4)
    // 地板底色（darkness 后的 vec3 字段，offset 280B → float[70..72]）
    au[70] = ambient.baseColor[0]
    au[71] = ambient.baseColor[1]
    au[72] = ambient.baseColor[2]
    au[68] = this.config.backgroundDarkness
    this.device.queue.writeBuffer(this.ambientUniform, 0, au)

    const encoder = this.device.createCommandEncoder()
    const view = this.context.getCurrentTexture().createView()
    const rtView = this.bgRTView
    if (rtView) {
      // Pass 1: Ambient 背景 → 半分辨率 sRGB RT（§35）
      {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: rtView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        })
        pass.setPipeline(this.ambientPipeline)
        pass.setBindGroup(0, this.ambientBind)
        pass.draw(3)
        pass.end()
      }

      // Pass 2: Upscale → canvas（双线性 + Vignette）
      {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
        })
        pass.setPipeline(this.upscalePipeline)
        pass.setBindGroup(0, this.upscaleBind)
        pass.draw(3)
        pass.end()
      }
    }

    // Pass 3: 封面流（本体 + 模糊层）
    if (total > 0) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setPipeline(this.coverPipeline)
      pass.setBindGroup(0, this.coverBind)
      pass.setVertexBuffer(0, this.quadVB)
      pass.setVertexBuffer(1, instanceBuffer)
      pass.setIndexBuffer(this.indexBuffer, 'uint16')
      pass.drawIndexed(6, total)
      pass.end()
    }

    this.device.queue.submit([encoder.finish()])
  }

  /**
   * 3D 拾取：把 CSS 坐标投影回场景，返回命中的封面 albumIndex（最近者优先）。
   * 每个封面用模型矩阵变换 4 角到 NDC，做点-in-convex-quad 测试（旋转封面也能命中）。
   */
  hitTest(
    items: readonly CoverTransform[],
    cssX: number,
    cssY: number,
    cssW: number,
    cssH: number,
  ): number | null {
    const nx = (cssX / Math.max(1, cssW)) * 2 - 1
    const ny = 1 - (cssY / Math.max(1, cssH)) * 2
    // items 按远→近排序：从近到远遍历，第一个命中即最近封面
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.opacity < 0.05) continue
      // 封面 4 角 → NDC
      const pts: Array<[number, number]> = []
      for (const [lx, ly] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        const p = this.projectToNdc(it, lx, ly)
        pts.push(p)
      }
      // 点-in-convex-quad：每条边叉积符号一致
      let sign = 0
      let inside = true
      for (let e = 0; e < 4; e++) {
        const a = pts[e]
        const b = pts[(e + 1) % 4]
        const cross = (b[0] - a[0]) * (ny - a[1]) - (b[1] - a[1]) * (nx - a[0])
        const s = cross > 0 ? 1 : cross < 0 ? -1 : 0
        if (s === 0) continue
        if (sign === 0) sign = s
        else if (s !== sign) {
          inside = false
          break
        }
      }
      if (inside) return it.albumIndex
    }
    return null
  }

  /** 封面局部坐标 → NDC（模型矩阵与 writeInstance 完全一致） */
  private projectToNdc(it: CoverTransform, lx: number, ly: number): [number, number] {
    const c = Math.cos(it.rotationY)
    const s = Math.sin(it.rotationY)
    const ss = this.config.coverSize * it.scale
    const wx = c * ss * lx + it.x
    const wy = ss * ly + it.y
    const wz = s * ss * lx + it.z
    const pv = this.projView
    const x = pv[0] * wx + pv[4] * wy + pv[8] * wz + pv[12]
    const y = pv[1] * wx + pv[5] * wy + pv[9] * wz + pv[13]
    const w = pv[3] * wx + pv[7] * wy + pv[11] * wz + pv[15]
    return [x / w, y / w]
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
