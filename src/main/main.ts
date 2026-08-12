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
  reflectionRatio?: number
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

              // 反射验证：中心封面正下方应比更下方的纯背景亮（位置相对窗口中心自适应）
              {
                const cx0 = Math.floor(w / 2) - 240
                const cx1 = Math.floor(w / 2) + 240
                const refY0 = Math.floor(h / 2) + 300
                const refY1 = Math.floor(h / 2) + 520
                const bgY0 = Math.min(h - 40, refY1 + 80)
                const bgY1 = Math.min(h - 10, bgY0 + 30)
                let refSum = 0
                let refN = 0
                let bgSum = 0
                let bgN = 0
                for (let y = refY0; y < Math.min(h, refY1); y += 4) {
                  for (let x = cx0; x < cx1; x += 4) {
                    const i = (y * w + x) * 4
                    refSum += Math.max(bmp[i], bmp[i + 1], bmp[i + 2])
                    refN++
                  }
                }
                for (let y = bgY0; y < bgY1; y += 4) {
                  for (let x = cx0; x < cx1; x += 4) {
                    const i = (y * w + x) * 4
                    bgSum += Math.max(bmp[i], bmp[i + 1], bmp[i + 2])
                    bgN++
                  }
                }
                const refAvg = refSum / Math.max(1, refN)
                const bgAvg = bgSum / Math.max(1, bgN)
                r.reflectionRatio = Number((refAvg / Math.max(1, bgAvg)).toFixed(3))
                console.log(`[SMOKE] reflection avg=${refAvg.toFixed(1)} vs bg=${bgAvg.toFixed(1)} (ratio ${r.reflectionRatio})`)
              }

              // 中心行亮度剖面（每 120 设备像素一个采样点，取最大通道），定位缺失的封面
              const profile: number[] = []
              for (let x = 0; x < w; x += 120) {
                const i = (rowY * w + x) * 4
                profile.push(Math.max(bmp[i], bmp[i + 1], bmp[i + 2]))
              }
              console.log('[SMOKE] row profile (max channel, every 120px): ' + profile.join(','))
            } catch {
              r.litRatio = -1
              r.centerRatio = -1
            }
            console.log('[SMOKE] ' + JSON.stringify(r))
            // 背景点亮后 centerRatio 无区分度，改用 litRatio + reflectionRatio 判定
            app.exit(r.ok && (r.litRatio ?? 0) > 0.1 && (r.reflectionRatio ?? 0) > 1.05 ? 0 : 1)
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
