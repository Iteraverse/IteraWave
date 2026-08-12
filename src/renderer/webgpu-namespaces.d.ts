/**
 * TS 7 (tsgo) 的 lib.dom 包含 WebGPU 接口与类型别名，但缺失命名空间常量对象
 * （GPUBufferUsage / GPUShaderStage / GPUTextureUsage 等）。
 * 此处按 WebGPU 规范补齐（值仅作为位标志使用，数字本身无跨版本风险）。
 */
declare namespace GPUBufferUsage {
  const MAP_READ: number
  const MAP_WRITE: number
  const COPY_SRC: number
  const COPY_DST: number
  const INDEX: number
  const VERTEX: number
  const UNIFORM: number
  const STORAGE: number
  const INDIRECT: number
  const QUERY_RESOLVE: number
}

declare namespace GPUShaderStage {
  const VERTEX: number
  const FRAGMENT: number
  const COMPUTE: number
}

declare namespace GPUTextureUsage {
  const COPY_SRC: number
  const COPY_DST: number
  const TEXTURE_BINDING: number
  const STORAGE_BINDING: number
  const RENDER_ATTACHMENT: number
}

/** tsgo lib.dom 缺失的 WebGPU 方法（规范定义） */
interface GPUCommandEncoder {
  generateMipmap(texture: GPUTexture): void
}
