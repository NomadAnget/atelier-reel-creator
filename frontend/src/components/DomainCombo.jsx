// 领域输入:可打字 + 下拉选已有(自定义 combobox)。不用原生 datalist——它在
// backdrop-filter/transform 容器(弹窗)里定位飘走(Chromium bug);下拉也不用绝对定位
// ——会被 .panel 的 overflow:hidden 裁掉。故用 portal 挂到 body + fixed 按输入框 rect 定位,
// 逃出一切 overflow/stacking,panel 与弹窗内都不裁不飞。
// 名词库(Knowledge)与监控源(Monitor)共用一份——领域候选的统一输入控件。
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function DomainCombo({ value, onChange, options = [], placeholder, style }) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const inputRef = useRef(null)
  const menuRef = useRef(null)

  const place = useCallback(() => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect())
  }, [])
  useEffect(() => {
    if (!open) return
    place()
    const onMove = () => place()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    const onDown = (e) => {
      if (inputRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, place])

  const q = String(value || '').toLowerCase()
  const filtered = options.filter(o => o.toLowerCase().includes(q))
  return (
    <div style={{ position: 'relative', ...style }}>
      <input ref={inputRef} className="input" style={{ width: '100%' }} value={value}
             placeholder={placeholder} title="术语库按此领域匹配;空=通用池"
             onChange={e => { onChange(e.target.value); setOpen(true) }}
             onFocus={() => setOpen(true)} />
      {open && rect && filtered.length > 0 && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', top: rect.bottom + 2, left: rect.left,
          width: rect.width, zIndex: 1000, background: 'var(--bg-elev)',
          border: '1px solid var(--border-strong)', borderRadius: 8, maxHeight: 180,
          overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
          {filtered.map(o => (
            <div key={o} onMouseDown={() => { onChange(o); setOpen(false) }}
              style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover, rgba(127,127,127,.14))' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              {o}</div>
          ))}
        </div>, document.body)}
    </div>
  )
}
