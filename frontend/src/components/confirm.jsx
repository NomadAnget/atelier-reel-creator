// 页内确认对话框(promise 式)——替代原生 window.confirm。
// 起因:WSLg 的 Chromium 里,原生 confirm() 关闭后会锁死随后打开的原生 <select>
// 弹层(实录:频道监控页删频道后,顶部三个下拉必然点不开)。React 渲染的浮层
// 不碰浏览器原生对话框栈,天然无此副作用。
// 用法:``if (!(await confirm('确定?'))) return`` —— 与原生同形,调用点近乎零改。
import { useEffect, useState } from 'react'

let _open = null   // ConfirmHost 挂载后注册;confirm() 经它拉起浮层

/** 返回 Promise<boolean>。ConfirmHost 未挂载时兜底回退原生 confirm(不至于静默放行)。 */
export function confirm(message) {
  if (!_open) return Promise.resolve(window.confirm(message))
  return new Promise((resolve) => _open({ message, resolve }))
}

/** 全站唯一实例:挂在 App 根。无待决请求时不渲染任何东西。 */
export function ConfirmHost() {
  const [pending, setPending] = useState(null)

  useEffect(() => {
    _open = setPending
    return () => { _open = null }
  }, [])

  useEffect(() => {
    if (!pending) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') done(false)
      if (e.key === 'Enter') done(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })   // 依赖 pending 闭包:每次待决重挂,拿到最新 resolve

  const done = (ok) => { pending?.resolve(ok); setPending(null) }
  if (!pending) return null

  return (
    <div onClick={() => done(false)}
         style={{ position: 'fixed', inset: 0, zIndex: 1000,
                  background: 'rgba(0,0,0,.45)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" onClick={(e) => e.stopPropagation()}
           style={{ maxWidth: 420, padding: '18px 20px', margin: 16 }}>
        <div style={{ fontSize: 14, whiteSpace: 'pre-line', lineHeight: 1.5,
                      marginBottom: 16 }}>
          {pending.message}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-outline btn-sm" onClick={() => done(false)}>取消</button>
          <button className="btn btn-primary btn-sm" autoFocus
                  onClick={() => done(true)}>确认</button>
        </div>
      </div>
    </div>
  )
}
