import type { Album } from '../album/Album.js'

/** 当前专辑元数据（§27）：极简排版，标题/艺术家/年份 */
export class AlbumInfo {
  constructor(
    private readonly root: HTMLElement,
    private readonly els: { title: HTMLElement; artist: HTMLElement; year: HTMLElement },
  ) {}

  update(album: Album | null): void {
    if (!album) {
      this.root.hidden = true
      return
    }
    this.root.hidden = false
    this.els.title.textContent = album.title
    this.els.artist.textContent = album.artist
    this.els.year.textContent = String(album.year)
  }
}
