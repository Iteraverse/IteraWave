import type { Album } from '../album/Album.js'

/**
 * 极简播放控件（§28）：播放/暂停 + 细进度条。
 * 演示数据无音频，为模拟播放（进度动画）；接入真实音乐库后替换为真实播放。
 */
export class PlaybackControls {
  playing = false
  private progress = 0
  private readonly duration = 30 // 模拟播放时长（秒）
  private currentAlbum: Album | null = null

  constructor(
    private readonly root: HTMLElement,
    private readonly btn: HTMLButtonElement,
    private readonly bar: HTMLElement,
    private readonly stateEl: HTMLElement,
    onToggle: () => void,
  ) {
    this.btn.addEventListener('click', onToggle)
    this.updateButton()
  }

  setAlbum(album: Album | null): void {
    this.currentAlbum = album
  }

  toggle(): void {
    this.playing = !this.playing
    if (!this.playing) {
      this.progress = 0
    }
    this.updateButton()
  }

  /** 每帧推进模拟进度 */
  update(dt: number): void {
    if (!this.playing) return
    this.progress = (this.progress + dt) % this.duration
    this.bar.style.width = `${(this.progress / this.duration) * 100}%`
    const t = this.progress
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    this.stateEl.textContent = `${this.currentAlbum ? this.currentAlbum.title : ''}  ${m}:${s.toString().padStart(2, '0')}`
  }

  private updateButton(): void {
    this.btn.innerHTML = this.playing ? '&#10073;&#10073;' : '&#9654;'
  }
}
