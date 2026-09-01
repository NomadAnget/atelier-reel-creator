// 全站唯一的 SSE 长连接:整个 App 一条 EventSource,按事件类型(msg/store/log)
// 扇出给各页订阅者。取代"每页各开一条、切页断连重连"——单连接、动态数据流切换。
//
// 用法:
//   页面里  useHubEvent('store', (data) => {...})   // 订阅某类事件,自动随卸载退订
//   需要连通态  const { connected } = useHubStreamCtx()
//
// 好处:切页不再断连(不丢重连间隙的事件);后端只维持一条长连;JSON.parse 每事件一次
// (原来每个订阅页各解一次)。
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { HUB_STREAM_URL } from '../api/hub'

const EVENTS = ['msg', 'store', 'log']
const HubStreamCtx = createContext(null)

export function HubStreamProvider({ children }) {
  // 每类事件一组订阅者(用 ref:增删订阅不该触发重渲染/重连)
  const handlers = useRef({ msg: new Set(), store: new Set(), log: new Set() })
  const [connected, setConnected] = useState(false)

  const subscribe = useCallback((event, fn) => {
    const set = handlers.current[event]
    if (!set) return () => {}
    set.add(fn)
    return () => set.delete(fn)      // 退订
  }, [])

  useEffect(() => {
    const es = new EventSource(HUB_STREAM_URL)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)   // 浏览器自动重连;connected 翻假供页面自愈
    const listeners = EVENTS.map((event) => {
      const on = (ev) => {
        let data
        try { data = JSON.parse(ev.data) } catch { return }
        handlers.current[event].forEach((fn) => { try { fn(data) } catch { /* 单订阅者出错不拖累其他 */ } })
      }
      es.addEventListener(event, on)
      return [event, on]
    })
    return () => {
      listeners.forEach(([event, on]) => es.removeEventListener(event, on))
      es.close()
    }
  }, [])

  return (
    <HubStreamCtx.Provider value={{ subscribe, connected }}>
      {children}
    </HubStreamCtx.Provider>
  )
}

export function useHubStreamCtx() {
  const ctx = useContext(HubStreamCtx)
  if (!ctx) throw new Error('useHubStreamCtx 必须在 <HubStreamProvider> 内使用')
  return ctx
}

// 订阅某类事件。handler 存 ref → 每次渲染换新闭包也不重订阅(不断流);
// 组件卸载或 event 变化时自动退订。
export function useHubEvent(event, handler) {
  const { subscribe } = useHubStreamCtx()
  const ref = useRef(handler)
  useEffect(() => { ref.current = handler })
  useEffect(() => subscribe(event, (data) => ref.current?.(data)), [event, subscribe])
}
