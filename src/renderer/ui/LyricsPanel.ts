import type { Album } from '../album/Album.js'

/**
 * 右侧歌词占位面板（专注模式显示）：
 * 演示数据无歌词，显示专辑名/艺术家 + 占位行；接入真实音乐库后替换为逐行歌词高亮。
 */
export class LyricsPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly titleEl: HTMLElement,
    private readonly artistEl: HTMLElement,
  ) {}

  setAlbum(album: Album | null): void {
    this.titleEl.textContent = album ? album.title : ''
    this.artistEl.textContent = album ? album.artist : ''
  }
}
