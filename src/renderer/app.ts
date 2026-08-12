import { AlbumLibrary } from './album/AlbumLibrary.js'
import type { Album } from './album/Album.js'
import { AlbumTextureCache } from './album/AlbumTextureCache.js'
import { AmbientField } from './ambient/AmbientField.js'
import { visualConfig } from './config/VisualConfig.js'
import { CoverFlowScene } from './coverflow/CoverFlowScene.js'
import { KeyboardController } from './input/KeyboardController.js'
import { MouseController } from './input/MouseController.js'
import { WheelController } from './input/WheelController.js'
import { Renderer } from './renderer/Renderer.js'
import { AlbumInfo } from './ui/AlbumInfo.js'
import { LyricsPanel } from './ui/LyricsPanel.js'
import { PlaybackControls } from './ui/PlaybackControls.js'
import { DebugPanel } from './ui/DebugPanel.js'

interface SmokeResult {
  ok: boolean
  error?: string
  fps?: number
  adapter?: string
  frames?: number
  litRatio?: number
  centerRatio?: number
  position?: number
}

const isSmoke = new URLSearchParams(location.search).get('smoke') === '1'
/** smoke 模式渲染帧数（约 0.5~1 秒） */
const SMOKE_FRAMES = 30
let smokeReported = false

async function run(): Promise<SmokeResult> {
  const canvas = document.getElementById('viewport') as HTMLCanvasElement
  const errBox = document.getElementById('error') as HTMLDivElement
  const fail = (msg: string): SmokeResult => {
    errBox.hidden = false
    errBox.textContent = msg
    return { ok: false, error: msg }
  }

  if (!navigator.gpu) {
    return fail('WebGPU 在此 Electron 构建中不可用。\n请确认显卡驱动支持 Direct3D 12。')
  }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return fail('未找到可用的 WebGPU adapter。')
  const device = await adapter.requestDevice()
  device.addEventListener('uncapturederror', (e) => {
    console.error('[GPU] uncaptured error:', e.error.message)
  })

  // 封面来源：优先 covers/ 目录的本地图片；为空则回退内置演示专辑
  const library = new AlbumLibrary()
  let albums: Album[] | null = null
  const covers = window.coversAPI ? await window.coversAPI.list().catch(() => []) : []
  if (covers.length > 0) {
    const loaded = await library.loadLocal(covers)
    console.log(`[albums] 本地封面 ${loaded.length}/${covers.length} 张（covers/）`)
    if (loaded.length > 0) albums = loaded
  }
  if (!albums) {
    albums = library.generateDemo(visualConfig.coverCount)
    console.log('[albums] 使用内置演示专辑')
  }
  const textures = await AlbumTextureCache.createTieredTextures(device, albums)

  const renderer = new Renderer(visualConfig)
  await renderer.init(canvas, device, textures)

  const scene = new CoverFlowScene(renderer, albums.length, visualConfig)
  const ambient = new AmbientField(visualConfig, albums.map((a) => a.palette))
  let lastIndex = -1

  // ---- UI（§27 元数据 / 播放控件 / §46 调试面板）----
  const metadataEl = document.getElementById('metadata') as HTMLDivElement
  const albumInfo = new AlbumInfo(metadataEl, {
    title: document.getElementById('meta-title') as HTMLDivElement,
    artist: document.getElementById('meta-artist') as HTMLDivElement,
    year: document.getElementById('meta-year') as HTMLDivElement,
  })
  const controlsEl = document.getElementById('controls') as HTMLDivElement
  const playback = new PlaybackControls(
    controlsEl,
    document.getElementById('btn-play') as HTMLButtonElement,
    document.getElementById('progress-bar') as HTMLDivElement,
    document.getElementById('play-state') as HTMLSpanElement,
    () => playback.toggle(),
  )
  const debugPanel = new DebugPanel(
    document.getElementById('debug') as HTMLDivElement,
    document.getElementById('debug-stats') as HTMLDivElement,
    document.getElementById('debug-palette') as HTMLDivElement,
    document.getElementById('debug-sliders') as HTMLDivElement,
    visualConfig,
  )

  // 右侧歌词占位面板（专注模式显示，§27 扩展）
  const lyricsPanel = new LyricsPanel(
    document.getElementById('lyrics') as HTMLDivElement,
    document.getElementById('lyrics-title') as HTMLDivElement,
    document.getElementById('lyrics-artist') as HTMLDivElement,
  )
  // 专注模式：body.focused 驱动 CSS（歌词滑入 / 进度条弹出 / 元数据隐藏）
  scene.onFocusChange = (index) => {
    document.body.classList.toggle('focused', index !== null)
    lyricsPanel.setAlbum(index !== null ? albums[index] : null)
    if (index !== null) {
      controlsEl.hidden = false
      controlsEl.classList.add('visible')
    } else if (!document.fullscreenElement) {
      controlsEl.classList.remove('visible')
      controlsEl.hidden = true
    }
  }

  // 全屏时 UI 自动隐藏；鼠标移到底部显示播放控件（§29）
  let hideControlsTimer = 0
  const showControls = (): void => {
    if (!document.fullscreenElement) return
    controlsEl.classList.add('visible')
    window.clearTimeout(hideControlsTimer)
    hideControlsTimer = window.setTimeout(() => controlsEl.classList.remove('visible'), 3000)
  }
  window.addEventListener('mousemove', (e) => {
    if (!document.fullscreenElement) return
    if (e.clientY > window.innerHeight * 0.85) showControls()
  })
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      // 非专注模式才隐藏播放控件（专注模式进度条常驻）
      if (scene.focusedIndex === null) {
        controlsEl.classList.remove('visible')
        controlsEl.hidden = true
      }
      metadataEl.hidden = true
    } else {
      controlsEl.hidden = false
      metadataEl.hidden = false
    }
  })

  const mouse = new MouseController()
  const wheel = new WheelController()
  const keyboard = new KeyboardController()
  keyboard.callbacks.onPlayPause = () => playback.toggle()
  keyboard.callbacks.onFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }
  }
  keyboard.callbacks.onDebug = () => debugPanel.toggle()
  scene.attach(canvas, mouse, wheel, keyboard)

  const onResize = (): void => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio)
    scene.windowWidth = canvas.clientWidth
  }
  window.addEventListener('resize', onResize)
  onResize()

  // smoke 模式下输出 palette 验证 Phase 3 分析结果
  if (isSmoke) {
    console.log('[SMOKE] palette0: ' + JSON.stringify(albums[0].palette))
    // 暴露场景供主进程验证专注模式布局
    ;(window as unknown as { __scene: CoverFlowScene }).__scene = scene
  }

  return await new Promise<SmokeResult>((resolve) => {
    let frames = 0
    let fpsSum = 0
    let last = performance.now()

    const frame = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      try {
        scene.update(dt)
        const idx = scene.physics.currentIndex
        if (idx !== lastIndex) {
          lastIndex = idx
          ambient.setCurrentIndex(idx)
          const album = albums[idx] ?? null
          albumInfo.update(album)
          playback.setAlbum(album)
        }
        const ambientFrame = ambient.update(dt, scene.physics.velocity)
        renderer.render(scene.items, ambientFrame)
        playback.update(dt)
        const fps = dt > 0 ? 1 / dt : 0
        debugPanel.update({
          fps,
          frameMs: dt * 1000,
          index: idx,
          position: scene.position,
          velocity: scene.physics.velocity,
          blobCount: visualConfig.ambientBlobCount,
          palette: albums[idx]?.palette ?? null,
        })
      } catch (e) {
        console.error('[renderer] frame error:', e)
        resolve({ ok: false, error: e instanceof Error ? e.stack ?? e.message : String(e) })
        return
      }
      frames++
      fpsSum += dt > 0 ? 1 / dt : 0

      // smoke：记录结果后继续渲染（主进程的 focus 检查需要动画持续运行）
      if (isSmoke && frames >= SMOKE_FRAMES && !smokeReported) {
        smokeReported = true
        const info = adapter.info
        resolve({
          ok: true,
          fps: Math.round(fpsSum / frames),
          adapter: `${info.vendor} / ${info.architecture} / ${info.description}`,
          frames,
          position: scene.position,
        })
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

void run()
  .then((result) => {
    if (isSmoke) {
      ;(window as unknown as { __smokeResult: SmokeResult }).__smokeResult = result
    }
  })
  .catch((e: unknown) => {
    console.error('[renderer] fatal:', e)
    if (isSmoke) {
      ;(window as unknown as { __smokeResult: SmokeResult }).__smokeResult = {
        ok: false,
        error: e instanceof Error ? e.stack ?? e.message : String(e),
      }
    }
  })
