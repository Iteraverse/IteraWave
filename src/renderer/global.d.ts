// preload 暴露的封面目录查询接口（见 src/main/preload.cjs）
interface LocalCover {
  url: string
  name: string
  year: number
}

interface Window {
  coversAPI?: {
    list: () => Promise<LocalCover[]>
  }
}
