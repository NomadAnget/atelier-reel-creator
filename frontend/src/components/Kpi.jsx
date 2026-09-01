// KPI 指标卡:语义色经 --kpi 注入、图标走统一 SVG;数值变化时数字平滑滚动,
// 并短暂闪现 ↑/↓ 方向指示(绿升红降)。
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

// 数字滚动:数值变化时 ~420ms easeOutCubic 平滑过渡;非数值(文本/百分比字符串)直接透传
function useAnimatedNumber(value) {
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)
  useEffect(() => {
    const from = prevRef.current
    prevRef.current = value
    if (from === value) return
    if (typeof from !== 'number' || typeof value !== 'number') { setDisplay(value); return }
    const start = performance.now()
    const dur = 420
    let raf
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return display
}

export default function Kpi({ icon, tone, value, label, sub }) {
  const v = useAnimatedNumber(value)
  const [delta, setDelta] = useState(null)   // 'up' | 'down' | null
  const prevRef = useRef(value)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = value
    if (typeof prev === 'number' && typeof value === 'number' && value !== prev) {
      setDelta(value > prev ? 'up' : 'down')
      const t = setTimeout(() => setDelta(null), 1400)
      return () => clearTimeout(t)
    }
  }, [value])
  return (
    <div className="kpi" style={{ '--kpi': tone }}>
      <div className="kpi-icon"><Icon name={icon} size={18} /></div>
      <div className="kpi-value">
        {v}
        {delta && <span className={`kpi-delta ${delta}`}>{delta === 'up' ? '↑' : '↓'}</span>}
      </div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}
