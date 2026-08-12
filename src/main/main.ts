import { app, BrowserWindow, ipcMain } from 'electron'
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 确保 WebGPU 在 Electron 中启用（较新 Chromium 默认开启，此开关无害且保险）
app.commandLine.appendSwitch('enable-unsafe-webgpu')

const isSmoke = process.env.SMOKE_TEST === '1' || process.argv.includes('--smoke')

interface SmokeResult {
  ok: boolean
  error?: string
  fps?: number
  adapter?: string
  frames?: number
  litRatio?: number
  centerRatio?: number
  cornerCheck?: boolean
  cornersMin?: number
  focusCheck?: boolean
  focusLayout?: boolean
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0b0e',
    autoHideMenuBar: true,
    title: 'Album Flow',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // 显式拼接 query（loadFile 的 query 参数在部分 Electron 版本不可靠）
  const indexPath = path.join(__dirname, '..', 'renderer', 'index.html')
  const indexUrl =
    'file://' + indexPath.replace(/\\/g, '/') + (isSmoke ? '?smoke=1' : '')
  void win.loadURL(indexUrl)

  if (isSmoke) {
    // smoke 模式：转发 renderer 控制台日志，便于诊断（Electron 43: 参数在 event 对象上）
    win.webContents.on('console-message', (event) => {
      const e = event as unknown as { message?: unknown }
      const msg = typeof e.message === 'string' ? e.message : String(event)
      if (msg.startsWith('[SMOKE]')) console.log(msg)
      else console.log('[renderer]', msg)
    })
    // smoke 模式：轮询 renderer 报告的 window.__smokeResult，超时退出
    win.webContents.once('did-finish-load', () => {
      const deadline = Date.now() + 20000
      const poll = async (): Promise<void> => {
        try {
          const r = (await win.webContents.executeJavaScript('window.__smokeResult ?? null')) as SmokeResult | null
          if (r) {
            // 截屏验证画面确实有内容：
            // 1) 全局亮像素比例（背景+封面）
            // 2) 中央封面区域亮像素比例（封面必须渲染在屏幕中心）
            try {
              const img = await win.webContents.capturePage()
              const bmp = img.getBitmap() as unknown as Uint8Array
              const { width: w, height: h } = img.getSize()
              let lit = 0
              let total = 0
              let centerLit = 0
              let centerTotal = 0
              const cx0 = Math.floor(w / 2) - 320
              const cx1 = Math.floor(w / 2) + 320
              const cy0 = Math.floor(h / 2) - 260
              const cy1 = Math.floor(h / 2) + 260
              for (let y = 0; y < h; y += 2) {
                for (let x = 0; x < w; x += 2) {
                  const i = (y * w + x) * 4
                  const bright = bmp[i] > 8 || bmp[i + 1] > 8 || bmp[i + 2] > 8
                  total++
                  if (bright) lit++
                  if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
                    centerTotal++
                    // 封面主体亮度远高于背景（背景中心 ≈ 22/24/32），用 60 阈值严格区分
                    if (bmp[i] > 60 || bmp[i + 1] > 60 || bmp[i + 2] > 60) centerLit++
                  }
                }
              }
              r.litRatio = Number((lit / total).toFixed(3))
              r.centerRatio = Number((centerLit / centerTotal).toFixed(3))

              // 中心行亮段 = 各封面的投影宽度（验证 3D 旋转：相邻封面应明显窄于中心封面）
              const rowY = Math.floor(h / 2)
              const segments: number[][] = []
              let segStart = -1
              for (let x = 0; x < w; x++) {
                const i = (rowY * w + x) * 4
                const bright = bmp[i] > 60 || bmp[i + 1] > 60 || bmp[i + 2] > 60
                if (bright && segStart < 0) segStart = x
                if (!bright && segStart >= 0) {
                  segments.push([segStart, x - 1, x - segStart])
                  segStart = -1
                }
              }
              if (segStart >= 0) segments.push([segStart, w - 1, w - segStart])
              console.log('[SMOKE] row segments [x0,x1,width]:', JSON.stringify(segments))

              // 中心行亮度剖面（每 120 设备像素一个采样点，取最大通道），定位缺失的封面
              const profile: number[] = []
              for (let x = 0; x < w; x += 120) {
                const i = (rowY * w + x) * 4
                profile.push(Math.max(bmp[i], bmp[i + 1], bmp[i + 2]))
              }
              console.log('[SMOKE] row profile (max channel, every 120px): ' + profile.join(','))

              // 圆角验证：中心封面左上角（圆角裁剪区）应明显暗于封面中心
              // 中心封面投影 ≈ 窗口宽 0.2375、高 0.422；角点向内偏移 0.012 比例
              {
                const ccx = Math.floor(w / 2)
                const ccy = Math.floor(h / 2)
                const insetX = Math.max(2, Math.floor(w * 0.012))
                const insetY = Math.max(2, Math.floor(h * 0.012))
                const cornerX = Math.floor(ccx - w * 0.2375 / 2 + insetX)
                const cornerY = Math.floor(ccy - h * 0.422 / 2 + insetY)
                const pix = (x: number, y: number): number => {
                  const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4
                  return Math.max(bmp[i], bmp[i + 1], bmp[i + 2])
                }
                // 封面中心区域最亮值（图片中心可能偏暗，取 ±80px 区域 max）
                let centerL = 0
                for (let dy = -80; dy <= 80; dy += 16) {
                  for (let dx = -80; dx <= 80; dx += 16) {
                    centerL = Math.max(centerL, pix(ccx + dx, ccy + dy))
                  }
                }
                const cornerL = pix(cornerX, cornerY)
                console.log(`[SMOKE] corner check: center=${centerL} corner=${cornerL}`)
                r.cornerCheck = centerL > 80 && cornerL < centerL * 0.55

                // 屏幕四角亮度采样（验证 vignette/黑纱不会让角落死黑）
                const quad = (x0: number, y0: number): number => {
                  let sum = 0
                  let n = 0
                  for (let y = y0; y < Math.min(h, y0 + 48); y += 4) {
                    for (let x = x0; x < Math.min(w, x0 + 48); x += 4) {
                      sum += pix(x, y)
                      n++
                    }
                  }
                  return Math.round(sum / Math.max(1, n))
                }
                const tl = quad(8, 8)
                const tr = quad(w - 56, 8)
                const bl = quad(8, h - 56)
                const br = quad(w - 56, h - 56)
                console.log(`[SMOKE] corners TL=${tl} TR=${tr} BL=${bl} BR=${br}`)
                r.cornersMin = Math.min(tl, tr, bl, br)
              }
            } catch {
              r.litRatio = -1
              r.centerRatio = -1
            }
            console.log('[SMOKE] ' + JSON.stringify(r))
            // 专注模式检查：模拟点击中心封面 → 进入专注模式；Esc → 退出
            void (async () => {
              const js = `(() => {
                const c = document.getElementById('viewport')
                const w = window.innerWidth, h = window.innerHeight
                const opts = { bubbles: true, clientX: w / 2, clientY: h / 2, button: 0, pointerId: 1 }
                c.dispatchEvent(new PointerEvent('pointerdown', opts))
                c.dispatchEvent(new PointerEvent('pointerup', opts))
                return true
              })()`
              await win.webContents.executeJavaScript(js)
              await new Promise((res) => setTimeout(res, 900))
              const focused = await win.webContents.executeJavaScript(
                'document.body.classList.contains("focused")',
              )
              // 专注模式布局验证：主封面应放大（1.32）、左移（x≈-152）、转正、z≈0
              if (focused) {
                try {
                  const info = (await win.webContents.executeJavaScript(`(() => {
                    const s = window.__scene
                    const idx = s.focusedIndex
                    if (idx === null) return null
                    const it = s.items.find((i) => i.albumIndex === idx)
                    if (!it) return null
                    return { x: it.x, scale: it.scale, z: it.z, rot: it.rotationY, t: s.focusT }
                  })()`)) as { x: number; scale: number; z: number; rot: number; t: number } | null
                  console.log(`[SMOKE] focus layout: ${JSON.stringify(info)}`)
                  r.focusLayout =
                    info !== null &&
                    Math.abs(info.x + 228) < 40 &&
                    Math.abs(info.scale - 1.32) < 0.05 &&
                    Math.abs(info.z) < 40 &&
                    Math.abs(info.rot) < 0.05
                } catch {
                  r.focusLayout = false
                }
              }
              await win.webContents.executeJavaScript(
                `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`,
              )
              await new Promise((res) => setTimeout(res, 700))
              const exited = await win.webContents.executeJavaScript(
                '!document.body.classList.contains("focused")',
              )
              console.log(`[SMOKE] focus mode: enter=${focused} exit=${exited}`)
              r.focusCheck = focused && exited
              app.exit(
                r.ok &&
                  (r.litRatio ?? 0) > 0.1 &&
                  (r.centerRatio ?? 0) > 0.05 &&
                  r.cornerCheck !== false &&
                  r.focusCheck !== false &&
                  r.focusLayout !== false
                  ? 0
                  : 1,
              )
            })()
            return
          }
        } catch (e) {
          console.error('[SMOKE] renderer unavailable:', String(e))
          app.exit(1)
          return
        }
        if (Date.now() > deadline) {
          console.error('[SMOKE] timeout: no result from renderer')
          app.exit(1)
          return
        }
        setTimeout(() => void poll(), 500)
      }
      setTimeout(() => void poll(), 800)
    })
  }
}

void app.whenReady().then(() => {
  registerCoversIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

// ---- 本地封面目录（covers/）----

const COVER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'])

interface LocalCover {
  url: string
  name: string
  year: number
}

/** 扫描项目根 covers/ 目录，返回图片文件列表（渲染进程经 preload 调用） */
function registerCoversIpc(): void {
  ipcMain.handle('covers:list', (): LocalCover[] => {
    const coversDir = path.join(app.getAppPath(), 'covers')
    try {
      return readdirSync(coversDir)
        .filter((f) => COVER_EXTS.has(path.extname(f).toLowerCase()))
        .map((f) => {
          const full = path.join(coversDir, f)
          return {
            url: pathToFileURL(full).href,
            name: path.basename(f, path.extname(f)),
            year: statSync(full).mtime.getFullYear(),
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      // covers/ 不存在或不可读 → 空列表（应用回退内置演示专辑）
      return []
    }
  })
}
