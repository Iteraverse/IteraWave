/**
 * 全部视觉/物理参数集中管理（文档 §45：参数必须全部可调，禁止硬编码）。
 * Phase 1 只用到 Cover Flow 相关参数；后续 Phase 直接在此扩展。
 */
export interface VisualConfig {
  /** 封面显示尺寸（CSS 像素，z=0 平面上中心封面） */
  coverSize: number
  /** 封面纹理分辨率（像素，正方形） */
  coverTextureSize: number
  /** 相邻封面中心间距（CSS 像素） */
  coverSpacing: number
  /** 深度衰减系数：z = -pow(distance, 1.5) * coverDepth */
  coverDepth: number
  /** 最大旋转角（度），offset=1 时达到 */
  coverMaxAngle: number
  /** 远处封面的侧立角（度），offset≥3 时收敛（Apple 风格：远处接近侧立成一条线） */
  coverFarAngle: number
  /** 透视距离下限（CSS 像素） */
  coverPerspectiveMin: number
  /** 透视距离上限（CSS 像素） */
  coverPerspectiveMax: number
  /** 透视距离 = 窗口宽度 * 该系数 */
  coverPerspectiveFactor: number

  /** 弹簧刚度（spring-damper: a = (target - pos) * stiffness - vel * damping） */
  springStiffness: number
  /** 弹簧阻尼 */
  springDamping: number
  /** 惯性摩擦系数（每 60fps 帧衰减，帧率无关换算） */
  scrollFriction: number
  /** 释放拖拽后，低于该速度直接 snap（否则先惯性滑行） */
  snapVelocityThreshold: number
  /** 惯性滑行停止速度，低于则 snap */
  inertiaStopVelocity: number

  /** 远处封面透明度衰减强度（opacity = 1 - smoothstep(0.5,6,d) * 该值） */
  opacityFalloff: number
  /** 远处封面亮度衰减强度（brightness = 1 - smoothstep(0.2,3,d) * 该值） */
  brightnessFalloff: number

  /** 封面圆角半径（封面宽度的比例，0 = 直角） */
  coverCornerRadius: number

  /** Ambient 背景（§4-§9）：blob 数量 */
  ambientBlobCount: number
  /** blob 半径基准（相对画面宽度，0..1） */
  ambientBlobRadius: number
  /** blob 运动速度系数（1 = 文档推荐周期 15-60s） */
  ambientBlobSpeed: number
  /** blob 颜色强度 */
  ambientIntensity: number
  /** 背景饱和度系数（albumSaturation × 该值，§38 0.35~0.65） */
  ambientSaturation: number
  /** 背景亮度系数（albumBrightness × 该值，§38 0.25~0.5） */
  ambientBrightness: number
  /** Palette 过渡时长（秒，§10 700~1400ms） */
  paletteTransitionDuration: number
  /** 封面流速度对背景幅度的响应系数（§40 0.03~0.08） */
  ambientVelocityResponse: number
  /** 暗角强度（0..1） */
  vignetteStrength: number
  /** 背景黑纱（整体压暗，保证文字/封面可读，§38） */
  backgroundDarkness: number
  /** 地板底色系数：palette average × 该值 作全局底色（0 = 无，角落可能全黑） */
  ambientFloor: number

  /** 演示专辑数量 */
  coverCount: number
}

export const visualConfig: VisualConfig = {
  coverSize: 380,
  coverTextureSize: 512,
  // 封面朝外（V 形）时外侧缘靠近观察者会被透视放大，spacing 需收紧保持远处封面在屏内
  coverSpacing: 260,
  coverDepth: 60,
  // 角度经过透视翻转（perspective reversal）验证：近缘视线角必须小于远缘，
  // 即 tanθ < (persp - z)/x；offset=1/2/3 安全角分别 ≈77°/68°/61°（persp=1400）
  coverMaxAngle: 50,
  coverFarAngle: 68,
  coverPerspectiveMin: 900,
  coverPerspectiveMax: 1800,
  coverPerspectiveFactor: 0.875,

  springStiffness: 180,
  springDamping: 22,
  scrollFriction: 0.92,
  snapVelocityThreshold: 0.35,
  inertiaStopVelocity: 0.02,

  // 朝外（V 形）布局下近缘放大让远处封面偏宽，加强淡出让远处退后（Apple 风格）
  opacityFalloff: 0.85,
  brightnessFalloff: 0.55,

  // 封面圆角（圆角矩形 SDF 在 fragment shader 中裁剪）
  coverCornerRadius: 0.04,

  // Ambient 背景（GPU 色彩场，§4-§9/§38/§40）
  ambientBlobCount: 8,
  // 半径调小让色块更分明（而非糊成一片渐变）
  ambientBlobRadius: 0.2,
  // 运动加快：周期从 15-60s 收到 6-18s（AmbientField 内），这里系数 1.6
  ambientBlobSpeed: 1.6,
  // 背景亮度 ≈ 封面 × 0.25~0.45（§9）：强度与黑纱共同压低，但要保证不闷
  ambientIntensity: 1.1,
  ambientSaturation: 0.65,
  ambientBrightness: 0.46,
  paletteTransitionDuration: 1.1,
  ambientVelocityResponse: 0.05,
  // 暗角克制：0.4 会让四角明显发黑，降到 0.15 只保留轻微聚焦感
  vignetteStrength: 0.15,
  backgroundDarkness: 0.45,
  ambientFloor: 0.35,

  coverCount: 24,
}
