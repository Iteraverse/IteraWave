export interface KeyboardCallbacks {
  onLeft(): void
  onRight(): void
  onHome(): void
  onEnd(): void
  onPlayPause(): void
  onFullscreen(): void
  onDebug(): void
}

/** 键盘导航：← → 切换专辑；Home / End 跳转首尾。按住时节流连续翻页。 */
export class KeyboardController {
  callbacks: KeyboardCallbacks = {
    onLeft: () => {},
    onRight: () => {},
    onHome: () => {},
    onEnd: () => {},
    onPlayPause: () => {},
    onFullscreen: () => {},
    onDebug: () => {},
  }

  private lastAction = 0
  private readonly repeatIntervalMs = 160

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const now = performance.now()
    if (e.repeat && now - this.lastAction < this.repeatIntervalMs) return
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        this.callbacks.onLeft()
        break
      case 'ArrowRight':
        e.preventDefault()
        this.callbacks.onRight()
        break
      case 'Home':
        e.preventDefault()
        this.callbacks.onHome()
        break
      case 'End':
        e.preventDefault()
        this.callbacks.onEnd()
        break
      case ' ':
      case 'Enter':
        e.preventDefault()
        this.callbacks.onPlayPause()
        break
      case 'F11':
        e.preventDefault()
        this.callbacks.onFullscreen()
        break
      case 'F12':
        e.preventDefault()
        this.callbacks.onDebug()
        break
      default:
        return
    }
    this.lastAction = now
  }
}
