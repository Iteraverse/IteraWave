import type { VisualConfig } from '../config/VisualConfig.js'
import type { CoverTransform } from '../coverflow/CoverFlowLayout.js'
import type { AmbientFrame } from '../ambient/AmbientField.js'
import { AlbumTextureCache } from '../album/AlbumTextureCache.js'
import { COVER_SHADER, AMBIENT_SHADER, UPSCALE_SHADER } from './shaders.js'

const NEAR = 0.5
const FAR = 5000
/** 实例缓冲上限（同时可见封面 × 2：反射 + 本体；|offset|>7 不绘制） */
const MAX_INSTANCES = 32
/** 单个实例数据大小：mat4(64B) + layer(4B) + brightness(4B) + opacity(4B) + isReflection(4B) */
const INSTANCE_STRIDE = 80

/**
 * WebGPU 渲染器（文档 §31/§36）：
 * Ambient 背景 pass（半分辨率 RT，§35）→ Upscale pass（+Vignette）→ 封面/反射 pass。
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
    // 反射：采样低一档纹理（小图线性放大 = 天然模糊，替代 mip bias）
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
    // proj(mat4) + reflectionOpacity/Darken/Height
    this.projUniform = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
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
    // 封面 uniform：proj + 反射参数（§45 集中管理）
    const coverUniform = new Float32Array(20)
    coverUniform.set(projView)
    coverUniform[16] = this.config.reflectionOpacity
    coverUniform[17] = this.config.reflectionDarken
    coverUniform[18] = this.config.reflectionHeight
    coverUniform[19] = 0
    this.device.queue.writeBuffer(this.projUniform, 0, coverUniform)
  }

  /** 写入单个实例数据（模型矩阵 T*R*S 列主序 + 图层 + 亮度/透明度 + 反射标志） */
  private writeInstance(off: number, it: CoverTransform, layer: number, isReflection: boolean): void {
    const f32 = this.instanceF32
    const u32 = this.instanceU32
    const c = Math.cos(it.rotationY)
    const s = Math.sin(it.rotationY)
    const ss = this.config.coverSize * it.scale
    // 反射：y 方向压缩 reflectionHeight 倍并下移（顶边贴封面底边）；x/z 与本体一致
    const yScale = isReflection ? ss * this.config.reflectionHeight : ss
    const yOff = isReflection ? it.y - ss / 2 - (ss * this.config.reflectionHeight) / 2 : it.y
    f32[off + 0] = c * ss
    f32[off + 1] = 0
    f32[off + 2] = s * ss
    f32[off + 3] = 0
    f32[off + 4] = 0
    f32[off + 5] = yScale
    f32[off + 6] = 0
    f32[off + 7] = 0
    f32[off + 8] = -s
    f32[off + 9] = 0
    f32[off + 10] = c
    f32[off + 11] = 0
    f32[off + 12] = it.x
    f32[off + 13] = yOff
    f32[off + 14] = it.z
    f32[off + 15] = 1
    u32[off + 16] = layer
    f32[off + 17] = it.brightness
    f32[off + 18] = it.opacity
    f32[off + 19] = isReflection ? 1 : 0
  }

  /** 渲染一帧：Ambient 背景（半分辨率 RT）→ Upscale（+Vignette）→ 封面/反射（文档 §36/§35） */
  render(items: readonly CoverTransform[], ambient: AmbientFrame): void {
    const n = Math.min(items.length, Math.floor(MAX_INSTANCES / 2))

    // 填充实例数据：每个封面 2 个实例（反射先、本体后），items 已按远→近排序
    for (let i = 0; i < n; i++) {
      const it = items[i]
      const tier = AlbumTextureCache.tierForDistance(Math.abs(it.offset))
      const layer = AlbumTextureCache.layerFor(it.albumIndex, tier)
      const base = i * 2 * (INSTANCE_STRIDE / 4)
      this.writeInstance(base, it, layer, true)
      this.writeInstance(base + INSTANCE_STRIDE / 4, it, layer, false)
    }

    const instanceBuffer = this.instanceBuffers[this.instanceRing]
    this.instanceRing ^= 1
    this.device.queue.writeBuffer(instanceBuffer, 0, this.instanceData, 0, n * 2 * INSTANCE_STRIDE)

    // Ambient blob uniform（§8：位置/半径/强度/颜色每帧由 CPU 更新）
    const au = new Float32Array(76)
    // blobCount 是 u32：必须用整数位模式写入（f32 写 8.0 会变成 ~1e9 导致 shader 循环爆炸）
    new Uint32Array(au.buffer)[0] = ambient.blobCount
    au.set(ambient.data.subarray(0, ambient.blobCount * 8), 4)
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

    // Pass 3: 封面流 + 反射
    if (n > 0) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setPipeline(this.coverPipeline)
      pass.setBindGroup(0, this.coverBind)
      pass.setVertexBuffer(0, this.quadVB)
      pass.setVertexBuffer(1, instanceBuffer)
      pass.setIndexBuffer(this.indexBuffer, 'uint16')
      pass.drawIndexed(6, n * 2)
      pass.end()
    }

    this.device.queue.submit([encoder.finish()])
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
