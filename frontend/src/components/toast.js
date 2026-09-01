// 轻量全局 toast:模块级事件总线,零依赖、无需 React context。
// toast(message, type, duration) 触发;Toaster 组件订阅渲染。
let listeners = []
let seq = 0

export function toast(message, type = 'info', duration = 3200) {
  const id = ++seq
  listeners.forEach(fn => fn({ id, message, type }))
  if (duration > 0) setTimeout(() => dismissToast(id), duration)
  return id
}

export function dismissToast(id) {
  listeners.forEach(fn => fn({ id, dismiss: true }))
}

export function subscribeToast(fn) {
  listeners.push(fn)
  return () => { listeners = listeners.filter(f => f !== fn) }
}
