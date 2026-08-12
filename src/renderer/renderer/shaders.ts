/**
 * WGSL shader（Phase 1）。
 *
 * 颜色管线：封面纹理为 rgba8unorm-srgb（采样时硬件自动解码到线性空间）
 * → 线性空间乘 brightness / 混合 → linToSrgb 编码后输出到（非 sRGB）canvas。
 * 背景 pass 无混合，直接输出 sRGB 值。
 */

/** 封面 pass：实例化绘制三档 texture_2d_array，每 instance 一个模型矩阵 + 图层 + 亮度/透明度；fragment 圆角裁剪 */
export const COVER_SHADER = /* wgsl */ `
struct CoverUniforms {
  proj : mat4x4f,
  cornerRadius : f32,
  _pad : vec3f,
};
@group(0) @binding(0) var<uniform> cu : CoverUniforms;
@group(0) @binding(1) var coversFull : texture_2d_array<f32>;
@group(0) @binding(2) var coversMed : texture_2d_array<f32>;
@group(0) @binding(3) var coversThumb : texture_2d_array<f32>;
@group(0) @binding(4) var samp : sampler;

struct VSIn {
  @location(0) p : vec2f,
  @location(1) uv : vec2f,
  @location(2) m0 : vec4f,
  @location(3) m1 : vec4f,
  @location(4) m2 : vec4f,
  @location(5) m3 : vec4f,
  @location(6) layer : u32,
  @location(7) brightness : f32,
  @location(8) opacity : f32,
};

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) layer : u32,
  @location(2) mul : vec4f,
};

@vertex
fn vs(in : VSIn) -> VSOut {
  let model = mat4x4f(in.m0, in.m1, in.m2, in.m3);
  var out : VSOut;
  out.pos = cu.proj * model * vec4f(in.p, 0.0, 1.0);
  out.uv = in.uv;
  out.layer = in.layer;
  out.mul = vec4f(in.brightness, in.brightness, in.brightness, in.opacity);
  return out;
}

fn linToSrgb(c : vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

fn sampleCover(uv : vec2f, albumLayer : u32, tier : u32) -> vec4f {
  // textureSample must be in uniform control flow: sample all tiers unconditionally, then select
  let cFull = textureSample(coversFull, samp, uv, albumLayer);
  let cMed = textureSample(coversMed, samp, uv, albumLayer);
  let cThumb = textureSample(coversThumb, samp, uv, albumLayer);
  return select(select(cMed, cThumb, tier == 2u), cFull, tier == 0u);
}

// 圆角矩形 SDF：uv ∈ [0,1]²，r = 圆角半径（uv 单位）
fn roundedRectAlpha(uv : vec2f, r : f32) -> f32 {
  let b = vec2f(0.5 - r);
  let q = abs(uv - 0.5) - b;
  let dist = length(max(q, vec2f(0.0))) - r;
  let aa = max(fwidth(dist), 1e-4);
  return 1.0 - smoothstep(-aa, aa, dist);
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  let albumLayer = in.layer / 3u;
  var tier = in.layer % 3u;
  let c = sampleCover(in.uv, albumLayer, tier);
  var rgb = c.rgb * in.mul.rgb;
  var alpha = c.a * in.mul.a;
  // 圆角裁剪（抗锯齿），透明处露出 Ambient 背景
  alpha *= roundedRectAlpha(in.uv, cu.cornerRadius);
  return vec4f(linToSrgb(rgb), alpha);
}
`

/**
 * 背景 pass：全屏三角形 + 静态深色径向渐变。
 * 刻意保持极暗、克制（封面是主角）；Phase 4 将替换为 GPU Ambient Color Field。
 */
export const BG_SHADER = /* wgsl */ `
struct BgUniforms {
  resolution : vec2f,
};
@group(0) @binding(0) var<uniform> bu : BgUniforms;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var out : VSOut;
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[vi];
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = p * 0.5 + 0.5;
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  let aspect = bu.resolution.x / max(bu.resolution.y, 1.0);
  let p = vec2f((in.uv.x - 0.5) * aspect, in.uv.y - 0.5);
  let d = length(p);
  let t = smoothstep(0.10, 0.95, d);
  var col = mix(vec3f(0.085, 0.095, 0.125), vec3f(0.030, 0.034, 0.048), t);
  col += vec3f(0.010, 0.012, 0.018) * (1.0 - in.uv.y);
  col += vec3f(0.014, 0.009, 0.005) * in.uv.y;
  return vec4f(col, 1.0);
}
`

/**
 * Ambient 背景 pass（Phase 4）：渲染到半分辨率 sRGB RT。
 * 每个 blob 高斯影响叠加（§8），随后 Reinhard 亮度压缩 + 黑纱（§9）。
 * RT 为 sRGB 格式，输出自动编码；blob 数据由 CPU 每帧写入 uniform。
 */
export const AMBIENT_SHADER = /* wgsl */ `
struct AmbientUniforms {
  blobCount : u32,
  _p0 : u32,
  _p1 : u32,
  _p2 : u32,
  blobs : array<vec4f, 16>,
  darkness : f32,
  _pad : f32,
  base : vec3f, // 地板底色（palette average 暗版）
};
@group(0) @binding(0) var<uniform> au : AmbientUniforms;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var out : VSOut;
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[vi];
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = p * 0.5 + 0.5;
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  var col = vec3f(0.0);
  for (var i = 0u; i < au.blobCount; i++) {
    let b = au.blobs[i * 2u];      // x, y, radius, intensity
    let c = au.blobs[i * 2u + 1u]; // r, g, b, pad
    let d = distance(in.uv, b.xy);
    let influence = exp(-d * d / (2.0 * b.z * b.z));
    col += c.rgb * influence * b.w;
  }
  // 地板底色：palette average 的暗版，保证角落/间隙不会全黑
  col += au.base;
  col = col / (1.0 + col);           // Reinhard tone map（§8）
  col *= (1.0 - au.darkness);        // black veil（§9/§38）
  return vec4f(col, 1.0);
}
`

/** 背景 upscale pass：半分辨率 RT → canvas（双线性）+ Vignette（§5） */
export const UPSCALE_SHADER = /* wgsl */ `
struct UpscaleUniforms {
  vignetteStrength : f32,
  _p0 : f32,
  _p1 : f32,
  _p2 : f32,
};
@group(0) @binding(0) var<uniform> uu : UpscaleUniforms;
@group(0) @binding(1) var rt : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var out : VSOut;
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[vi];
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = p * 0.5 + 0.5;
  return out;
}

fn linToSrgb(c : vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  let c = textureSample(rt, samp, in.uv); // sRGB RT 自动解码回线性
  let d = distance(in.uv, vec2f(0.5, 0.5));
  let v = smoothstep(0.55, 1.15, d) * uu.vignetteStrength;
  let col = c.rgb * (1.0 - v);
  return vec4f(linToSrgb(col), 1.0);
}
`
