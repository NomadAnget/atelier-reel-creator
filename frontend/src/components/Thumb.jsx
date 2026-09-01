// 缩略图:加载失败自动退占位符(封面缺失/视频下架均如此处理,无本地缓存——
// 直接打 YouTube CDN 或产物封面窄口,靠浏览器自身 HTTP 缓存)。
// Jobs 卡片(任务产出/源视频)与 Monitor 发现表共用同一份逻辑。
import { useState } from 'react'

export default function Thumb({ src, placeholder, width = 128, height, aspectRatio }) {
  const [ok, setOk] = useState(true)
  // aspectRatio 优先(整幅横铺时按 16:9 定高);否则用固定 height;都缺省 = 拉伸到等高(72px 下限)
  const box = { width, borderRadius: 8, flexShrink: 0,
                background: 'var(--gray-200, #21262d)', objectFit: 'cover',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, overflow: 'hidden' }
  if (aspectRatio) box.aspectRatio = aspectRatio
  else if (height != null) box.height = height
  else { box.alignSelf = 'stretch'; box.minHeight = 72 }
  if (src && ok) return <img src={src} alt="" style={box} onError={() => setOk(false)} />
  return <div style={box}>{placeholder}</div>
}
