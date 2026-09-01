// 动态计时驱动器:active 时每秒触发一次重渲染,让「now - 锚点时间戳」类
// 显示自己走起来。计时不需要后端参与——锚点(started_at/updated_at)已随
// 数据到达,这里只提供本地时钟节拍;无任务在跑时归零成本(不挂 interval)。
import { useEffect, useState } from 'react'

export default function useTicker(active, intervalMs = 1000) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const t = setInterval(() => setTick(n => n + 1), intervalMs)
    return () => clearInterval(t)
  }, [active, intervalMs])
}
