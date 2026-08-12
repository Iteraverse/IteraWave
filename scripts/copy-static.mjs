// 构建后把渲染进程静态资源复制到 dist/renderer；preload 复制到 dist/main
import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('dist/renderer', { recursive: true })
mkdirSync('dist/main', { recursive: true })
cpSync('src/renderer/index.html', 'dist/renderer/index.html')
cpSync('src/renderer/style.css', 'dist/renderer/style.css')
cpSync('src/main/preload.cjs', 'dist/main/preload.cjs')
console.log('static assets copied')
