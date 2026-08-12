// Cover Flow 物理/布局模块的快速单元验证（Phase 1 核心逻辑）
// 运行：node scripts/verify-physics.mjs
import { CoverFlowPhysics } from '../dist/renderer/coverflow/CoverFlowPhysics.js'
import { CoverFlowLayout } from '../dist/renderer/coverflow/CoverFlowLayout.js'
import { visualConfig } from '../dist/renderer/config/VisualConfig.js'

let failures = 0
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

console.log('== CoverFlowLayout ==')
{
  const layout = new CoverFlowLayout(visualConfig)
  const items = layout.compute(0, 24)
  const center = items.find((i) => i.albumIndex === 0)
  check('center: x=0, rot=0, scale=1', center && center.x === 0 && center.rotationY === 0 && center.scale === 1)
  const right = items.find((i) => i.albumIndex === 1)
  const left = items.find((i) => i.albumIndex === -1) // 不存在（albumIndex 从 0 起）
  check('right neighbor: positive rotationY (朝外)', right && right.rotationY > 0, right ? `rot=${right.rotationY}` : 'missing')
  check('right neighbor: x = spacing', right && Math.abs(right.x - visualConfig.coverSpacing) < 1e-9)
  check('right neighbor: z < 0', right && right.z < 0)
  const far = items.find((i) => i.albumIndex === 6)
  check('far: dimmer & smaller', far && far.brightness < right.brightness && far.scale < right.scale && far.opacity < right.opacity)
  const far2 = items.find((i) => i.albumIndex === 2)
  check('angle progresses with distance (|rot| increases)', far2 && right && Math.abs(far2.rotationY) > Math.abs(right.rotationY),
    `rot1=${right?.rotationY.toFixed(3)} rot2=${far2?.rotationY.toFixed(3)}`)
  check('far angle = coverFarAngle (68°)', far && Math.abs(Math.abs(far.rotationY) - (68 * Math.PI) / 180) < 0.05,
    `rot6=${far?.rotationY.toFixed(3)}`)
  check('neighbor angle = maxAngle (50°)', right && Math.abs(Math.abs(right.rotationY) - (50 * Math.PI) / 180) < 0.001)
  const first = items[0]
  check('items sorted far→near (|offset| descending)', items.every((it, idx) => idx === 0 || Math.abs(it.offset) <= Math.abs(items[idx - 1].offset)))
}

console.log('== CoverFlowPhysics: spring step ==')
{
  const p = new CoverFlowPhysics(visualConfig, 0, 23)
  p.step(1)
  p.step(1)
  p.step(1)
  for (let i = 0; i < 600; i++) p.update(1 / 60)
  check('3 steps → position ≈ 3', Math.abs(p.position - 3) < 0.01, `pos=${p.position}`)
  check('mode idle after settle', p.mode === 'idle')
}

console.log('== CoverFlowPhysics: drag & inertia ==')
{
  const p = new CoverFlowPhysics(visualConfig, 0, 23)
  p.dragTo(2.4, 1 / 60)
  check('dragTo sets position', Math.abs(p.position - 2.4) < 1e-9)
  check('dragTo sets dragging mode', p.mode === 'dragging')
  // 快速拖动结束 → 惯性滑行
  p.dragTo(2.7, 1 / 60) // velocity = 0.3 / (1/60) = 18
  p.dragEnd()
  check('fast release → inertia', p.mode === 'inertia')
  let frames = 0
  while (p.mode === 'inertia' && frames < 1000) {
    p.update(1 / 60)
    frames++
  }
  check('inertia → spring (snap)', p.mode === 'spring', `mode=${p.mode} after ${frames} frames`)
  while (p.mode !== 'idle' && frames < 2000) {
    p.update(1 / 60)
    frames++
  }
  check('settles on integer index', Number.isInteger(p.position) && p.position >= 0 && p.position <= 23, `pos=${p.position}`)
}

console.log('== CoverFlowPhysics: slow release snaps directly ==')
{
  const p = new CoverFlowPhysics(visualConfig, 0, 23)
  p.dragTo(5.0, 1 / 60)
  p.dragTo(5.005, 1 / 60) // 低速（0.3 张/秒 < 阈值 0.35）
  p.dragEnd()
  check('slow release → spring directly', p.mode === 'spring')
}

console.log('== CoverFlowPhysics: bounds ==')
{
  const p = new CoverFlowPhysics(visualConfig, 0, 23)
  p.jumpTo(99)
  check('jumpTo clamps to max', p.target === 23)
  p.dragTo(-5, 1 / 60)
  check('dragTo clamps to min', p.position === 0)
}

console.log('== CoverFlowPhysics: frame-rate independent friction ==')
{
  const decay = (fps, frames) => {
    const p = new CoverFlowPhysics(visualConfig, 0, 23)
    p.velocity = 10
    p.mode = 'inertia'
    for (let i = 0; i < frames; i++) p.update(1 / fps)
    return p.velocity
  }
  const v60 = decay(60, 60) // 1 秒
  const v120 = decay(120, 120)
  const v30 = decay(30, 30)
  check('friction consistent across framerates', Math.abs(v60 - v120) < 0.02 && Math.abs(v60 - v30) < 0.02,
    `v60=${v60.toFixed(4)} v120=${v120.toFixed(4)} v30=${v30.toFixed(4)}`)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
