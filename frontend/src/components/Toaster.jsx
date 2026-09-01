// 全局 toast 渲染栈:订阅 toast 事件总线,右上角堆叠显示,自动消失/可手动关闭。
import { useEffect, useState } from 'react'
import { subscribeToast, dismissToast } from './toast'
import Icon from './Icon'

const ICON = { success: 'check', error: 'alert', info: 'info' }

export default function Toaster() {
  const [toasts, setToasts] = useState([])
  useEffect(() => subscribeToast(ev => {
    if (ev.dismiss) setToasts(prev => prev.filter(t => t.id !== ev.id))
    else setToasts(prev => [...prev, ev])
  }), [])
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <Icon name={ICON[t.type] || 'info'} size={15} />
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" title="关闭" onClick={() => dismissToast(t.id)}>
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
