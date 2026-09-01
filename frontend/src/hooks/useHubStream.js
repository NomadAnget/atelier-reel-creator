// 新系统总线的实时数据源:快照 + SSE(断线自愈:重连成功即重拉快照)。
// 产出:snap(拓扑/存储/账本)、stats(实时计数)、feed(最近事件流水)、
//       rate(msg/s,按 stats.published 差分——不受前端丢帧影响的真吞吐)、
//       lastMsg(最新消息,拓扑图脉冲用)。
// 连接不再自己开:订阅全站唯一的 HubStreamProvider(单连接扇出)。
import { useCallback, useEffect, useRef, useState } from 'react'
import { hubSnapshot } from '../api/hub'
import { useHubEvent, useHubStreamCtx } from './HubStream'

const FEED_MAX = 60

export default function useHubStream() {
  const [snap, setSnap] = useState(null)
  const [stats, setStats] = useState(null)
  const [feed, setFeed] = useState([])
  const [rate, setRate] = useState(0)
  const [error, setError] = useState('')
  const [lastMsg, setLastMsg] = useState(null)
  const lastPubRef = useRef(null)
  const statsRef = useRef(null)
  const storeTimerRef = useRef(null)
  const { connected } = useHubStreamCtx()

  const loadSnap = useCallback(async () => {
    try {
      const { data } = await hubSnapshot()
      setSnap(data)
      if (data.stats) { setStats(data.stats); statsRef.current = data.stats }
      setError('')
    } catch (e) {
      setError(e?.message || '无法连接新系统(serve 未运行?)')
    }
  }, [])

  // 存储写事件驱动的快照刷新(去抖:面板行数/账本跟上,不轮询)
  const refreshStoreDebounced = useCallback(() => {
    if (storeTimerRef.current) return
    storeTimerRef.current = setTimeout(() => {
      storeTimerRef.current = null
      loadSnap()
    }, 800)
  }, [loadSnap])

  useEffect(() => { loadSnap() }, [loadSnap])                            // 首载
  useEffect(() => { if (connected) loadSnap() }, [connected, loadSnap])  // 自愈:(重)连即重拉

  useHubEvent('msg', (m) => {
    if (m.stats) { setStats(m.stats); statsRef.current = m.stats }
    setLastMsg(m)
    setFeed((prev) => [{ kind: 'msg', ...m }, ...prev].slice(0, FEED_MAX))
  })
  useHubEvent('store', (m) => {
    setFeed((prev) => [{ kind: 'store', ...m }, ...prev].slice(0, FEED_MAX))
    refreshStoreDebounced()
  })

  useEffect(() => {
    const rateTimer = setInterval(() => {
      const pub = statsRef.current?.published
      if (pub != null && lastPubRef.current != null) setRate(pub - lastPubRef.current)
      lastPubRef.current = pub ?? lastPubRef.current
    }, 1000)
    return () => clearInterval(rateTimer)
  }, [])

  return { snap, stats, feed, rate, connected, error, reload: loadSnap, lastMsg }
}
