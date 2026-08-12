# Album Flow

Windows 沉浸式 Cover Flow 音乐浏览界面 — **Phase 1-6 全部完成**（Electron + TypeScript + WebGPU）。

> GPU 加速的 3D Cover Flow：真实透视投影、空间深度、惯性拖拽、弹簧吸附、圆角封面，
> 专辑主色驱动的动态 Ambient 色彩场（GPU shader）、调色过渡、暗角调色、元数据与调试面板。
> 内置 24 张程序生成的演示专辑，开箱即用。

## 运行

```powershell
npm install        # 首次（如 Electron 二进制下载失败，见下方镜像说明）
npm start          # 构建并启动
```

如果 Electron 二进制下载失败（GitHub 网络问题），使用镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
Remove-Item -Recurse -Force node_modules/electron
npm install electron --save-dev
```

## 使用自己的封面图片

把图片放进项目根目录的 **`covers/`** 文件夹，重启应用即可：

```
covers/
├── 说明.txt
├── Mono Lake - Mountain Light.jpg   ← 文件名格式：艺术家 - 标题
└── 随便一个名字.png                  ← 没有 " - " 时整名作标题
```

- 支持 `.jpg / .jpeg / .png / .webp / .bmp / .gif`，自动居中裁剪为正方形，数量不限
- 年份取文件修改时间；Ambient 背景色仍会自动从每张图提取（OKLab 分析）
- 清空该文件夹 → 自动回退内置 24 张演示专辑

## 操作

| 输入 | 行为 |
|---|---|
| 鼠标拖拽 | 1:1 跟随，松手后有惯性滑行，然后弹簧吸附最近专辑 |
| 滚轮 | 上下翻页（spring 过渡，不瞬间跳转） |
| 点击封面 | 进入**专注模式**：主封面放大左移、其他封面退后变暗，右侧歌词占位面板滑入，底部进度条弹出 |
| 专注模式中滚轮 / `←` `→` | 切换聚焦专辑 |
| 点击主封面 / 空白 / `Esc` | 退出专注模式 |
| `←` / `→` | 上一张 / 下一张 |
| `Home` / `End` | 跳转首 / 尾 |
| `Space` / `Enter` | 播放 / 暂停（演示数据为模拟播放） |
| `F11` | 全屏（UI 自动隐藏，鼠标移到底部显示播放控件） |
| `F12` | 调试面板（FPS/状态/调色板 + 实时参数滑块） |

## 验证

```powershell
npm run smoke      # 自动渲染 30 帧 + 截屏，验证 WebGPU/渲染/帧率
node scripts/verify-physics.mjs   # 物理与布局模块单元验证
```

## 模块结构（对应设计文档 §44）

```
src/renderer/
├── config/VisualConfig.ts    全部参数集中管理（§45）
├── album/                    Album / AlbumLibrary（演示封面生成）
│                             AlbumColorAnalyzer（OKLab K-Means 主色提取，§2/§3）
│                             AlbumTextureCache（三档分级纹理）
├── ambient/                  AmbientField（Color Blob 运动 / Palette 过渡 / 速度响应，§4-§9/§39/§40）
├── coverflow/                Scene / Layout（§13-14 数学）/ Physics（§20-24）/ Interaction
├── input/                    Mouse / Wheel / Keyboard 控制器
├── renderer/                 Renderer（WebGPU）/ WGSL shader（Ambient / Upscale / Cover）
└── ui/                       AlbumInfo（§27）/ PlaybackControls / DebugPanel（§46）
```

已完成：Phase 1（Cover Flow + 交互 + 弹簧）、Phase 2（纹理分级 §32/§34，反射已移除）、
Phase 3（AlbumColorAnalyzer §2/§3）、Phase 4（GPU Ambient Field §4-§9/§35）、
Phase 5（Palette 过渡 §10/§39 + 速度响应 §40 + Vignette/调色 §8/§9）、
Phase 6（元数据 §27 + 播放/全屏 §29 + 调试面板 §46）。
