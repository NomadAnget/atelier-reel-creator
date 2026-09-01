// 架构展示:两套视图可切换 —— 卡片契约视图(默认)/ 环形拓扑图(旧)。
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon'

const DOMAIN_COLOR = {
  web: '#2563eb', daemons: '#7c3aed', scheduler: '#9333ea', task: '#d97706',
  engines: '#ea580c', platform_adapters: '#db2777', publishers: '#0d9488', sentinel: '#dc2626',
}
const domainColor = (d) => DOMAIN_COLOR[d]
  || `hsl(${[...String(d || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 60% 55%)`

/* ═══════════════ 视图一:环形拓扑图(旧) ═══════════════ */

const W = 900, H = 620, CX = 450, CY = 300, RX = 330, RY = 225
const TRX = 74, TRY = 38

function* perms(a) {
  if (a.length <= 1) { yield a; return }
  for (let i = 0; i < a.length; i++)
    for (const p of perms([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...p]
}

function ringCost(order, chordEdges) {
  const idx = Object.fromEntries(order.map((d, i) => [d, i]))
  const n = order.length
  let cross = 0, span = 0
  const chords = chordEdges.map(([a, b]) => {
    let pa = idx[a], pb = idx[b]
    if (pa > pb) [pa, pb] = [pb, pa]
    span += Math.min(pb - pa, n - (pb - pa))
    return [pa, pb]
  })
  for (let i = 0; i < chords.length; i++)
    for (let j = i + 1; j < chords.length; j++) {
      const [a, b] = chords[i], [c, d] = chords[j]
      if (a === c || a === d || b === c || b === d) continue
      if ((c > a && c < b) !== (d > a && d < b)) cross++
    }
  return cross * 100 + span
}

const _orderCache = new Map()

function layoutNodes(domains, edges) {
  const names = Object.keys(domains).sort()
  const und = [...new Set(edges.map(e => [e.from, e.to].sort().join('|')))]
    .map(k => k.split('|')).filter(([a, b]) => a !== b)
  const sig = names.join(',') + '#' + und.map(e => e.join('>')).sort().join(',')
  let order = _orderCache.get(sig)
  if (!order) {
    order = names
    if (names.length >= 3 && names.length <= 9) {
      const [first, ...rest] = names
      let best = names, bc = Infinity
      for (const p of perms(rest)) {
        const o = [first, ...p], c = ringCost(o, und)
        if (c < bc) { bc = c; best = o }
      }
      order = best
    }
    _orderCache.clear()
    _orderCache.set(sig, order)
  }
  const anchor = names.reduce((m, d) =>
    domains[d].publishes.length > domains[m].publishes.length ? d : m, names[0])
  const r = order.indexOf(anchor)
  order = [...order.slice(r), ...order.slice(0, r)]
  const pos = {}
  order.forEach((d, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / order.length
    pos[d] = { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) }
  })
  return pos
}

function trim(p, ctrl, rx = TRX, ry = TRY) {
  const dx = ctrl.x - p.x, dy = ctrl.y - p.y, l = Math.hypot(dx, dy) || 1
  const ux = dx / l, uy = dy / l
  const r = 1 / Math.sqrt((ux / rx) ** 2 + (uy / ry) ** 2)
  return { x: p.x + ux * r, y: p.y + uy * r }
}

function edgePath(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
  let ox = mx - CX, oy = my - CY
  const ol = Math.hypot(ox, oy)
  if (ol < 1) { ox = -dy / len; oy = dx / len } else { ox /= ol; oy /= ol }
  const bow = 16 + len * 0.2
  const c = { x: mx + ox * bow - (dy / len) * 9, y: my + oy * bow + (dx / len) * 9 }
  const p1 = trim(a, c), p2 = trim(b, c)
  const d = `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${c.x.toFixed(1)} ${c.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  // 二次贝塞尔中点(t=0.5)作为边标签位置
  const lx = 0.25 * p1.x + 0.5 * c.x + 0.25 * p2.x
  const ly = 0.25 * p1.y + 0.5 * c.y + 0.25 * p2.y
  return { d, lx, ly }
}

function RingGraph({ snap, lastMsg }) {
  const [hot, setHot] = useState({})
  const [focus, setFocus] = useState(null)
  const [tip, setTip] = useState(null)
  const timersRef = useRef([])

  const { pos, pairs, topicPairs, storeOwners, neighbors } = useMemo(() => {
    if (!snap) return { pos: {}, pairs: [], topicPairs: {}, storeOwners: [], neighbors: {} }
    const pos = layoutNodes(snap.domains, snap.edges)
    const agg = {}
    const topicPairs = {}
    const neighbors = Object.fromEntries(Object.keys(snap.domains).map(d => [d, new Set([d])]))
    for (const e of snap.edges) {
      const key = `${e.from}→${e.to}`
      if (!agg[key]) {
        const ep = edgePath(pos[e.from], pos[e.to])
        agg[key] = { key, from: e.from, to: e.to, topics: new Set(), ...ep }
      }
      agg[key].topics.add(e.topic)
      neighbors[e.from].add(e.to); neighbors[e.to].add(e.from)
      ;(topicPairs[e.topic] = topicPairs[e.topic] || []).push(key)
    }
    const storeOwners = [...new Set(Object.values(snap.store || {}).map(t => t.owner))]
      .filter(d => pos[d])
    return { pos, pairs: Object.values(agg), topicPairs, storeOwners, neighbors }
  }, [snap])

  useEffect(() => {
    if (!lastMsg) return
    const until = Date.now() + 650
    const keys = [lastMsg.source, ...(topicPairs[lastMsg.topic] || [])]
    setHot(prev => {
      const next = { ...prev }
      keys.forEach(k => { next[k] = until })
      return next
    })
    const t = setTimeout(() =>
      setHot(prev => Object.fromEntries(Object.entries(prev).filter(([, v]) => v > Date.now()))), 700)
    timersRef.current.push(t)
    return undefined
  }, [lastMsg, topicPairs])
  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])

  if (!snap) return null
  const isHot = (k) => (hot[k] || 0) > Date.now()
  const center = { x: CX, y: CY }
  const hasStore = Object.keys(snap.store || {}).length > 0
  const dimEdge = (p) => focus && p.from !== focus && p.to !== focus
  const dimNode = (d) => focus && !neighbors[focus]?.has(d)
  const dimSpoke = (d) => focus && d !== focus
  const anchor = (e) => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200
    return { left: Math.min(e.clientX + 14, w - 340), top: Math.max(8, e.clientY + 10) }
  }
  const clearTip = () => setTip(null)

  return (
    <>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
         style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <marker id="hub-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--gray-400, #8b949e)" />
        </marker>
      </defs>
      {storeOwners.map(d => {
        const p1 = trim(pos[d], center)
        const p2 = trim(center, pos[d], 70, 34)
        return <path key={`s-${d}`} className={`hubg-sedge${dimSpoke(d) ? ' dim' : ''}`}
          d={`M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`} />
      })}
      {pairs.map(p => (
        <g key={p.key}>
          <path d={p.d} markerEnd="url(#hub-arrow)"
                className={`hubg-edge${isHot(p.key) ? ' hot' : ''}${dimEdge(p) ? ' dim' : ''}`}
                onMouseEnter={(e) => setTip({ kind: 'edge', from: p.from, to: p.to, topics: [...p.topics], ...anchor(e) })}
                onMouseLeave={clearTip}>
            <title>{[...p.topics].join('\n')}</title>
          </path>
          {p.topics.size > 1 && (
            <text x={p.lx} y={p.ly} textAnchor="middle"
                  className={`hubg-edge-label${dimEdge(p) ? ' dim' : ''}`}>{p.topics.size}</text>
          )}
        </g>
      ))}
      {hasStore && (
        <g transform={`translate(${CX - 62},${CY - 26})`} className="hubg-snode"
           onMouseEnter={(e) => setTip({ kind: 'hub', ...anchor(e) })} onMouseLeave={clearTip}>
          <rect width="124" height="52" rx="9" />
          <text x="62" y="22" textAnchor="middle" className="name">存储枢纽</text>
          <text x="62" y="40" textAnchor="middle" className="meta">
            {Object.keys(snap.store).length} 张表
          </text>
        </g>
      )}
      {Object.entries(snap.domains).map(([d, info]) => (
        <g key={d} transform={`translate(${pos[d].x - 62},${pos[d].y - 26})`}
           className={`hubg-node${isHot(d) ? ' hot' : ''}${dimNode(d) ? ' dim' : ''}`}
           onMouseEnter={(e) => { setFocus(d); setTip({ kind: 'domain', domain: d, ...anchor(e) }) }}
           onMouseLeave={() => { setFocus(null); clearTip() }}>
          <rect width="124" height="52" rx="9" />
          <text x="62" y="22" textAnchor="middle" className="name">{d}</text>
          <text x="62" y="40" textAnchor="middle" className="meta">
            发 {info.publishes.length} · 订 {Object.keys(info.subscribes).length}
          </text>
        </g>
      ))}
    </svg>
    {tip && createPortal(
      tip.kind === 'domain'
        ? <ArchTip snap={snap} domain={tip.domain} left={tip.left} top={tip.top} />
        : tip.kind === 'hub'
          ? <HubTip store={snap.store} left={tip.left} top={tip.top} />
          : <EdgeTip from={tip.from} to={tip.to} topics={tip.topics} left={tip.left} top={tip.top} />,
      document.body
    )}
    </>
  )
}

/* ═══════════════ 视图二:卡片契约视图(默认) ═══════════════ */

const LINE_CHARS = 36
const relLines = (set) => {
  if (!set || !set.size) return 0
  let chars = 0
  for (const n of set) chars += n.length + 3
  return Math.max(1, Math.ceil(chars / LINE_CHARS))
}

function CardGraph({ snap, lastMsg }) {
  const [hot, setHot] = useState({})
  const [tip, setTip] = useState(null)
  const timersRef = useRef([])

  useEffect(() => {
    if (!lastMsg) return
    const until = Date.now() + 650
    setHot(prev => ({ ...prev, [lastMsg.source]: until }))
    const t = setTimeout(() =>
      setHot(prev => Object.fromEntries(Object.entries(prev).filter(([, v]) => v > Date.now()))), 700)
    timersRef.current.push(t)
    return undefined
  }, [lastMsg])
  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])

  if (!snap) return null
  const isHot = (d) => (hot[d] || 0) > Date.now()

  const rel = {}
  for (const d of Object.keys(snap.domains)) rel[d] = { subsFrom: new Set(), pubsTo: new Set() }
  for (const e of snap.edges || []) {
    if (rel[e.to]) rel[e.to].subsFrom.add(e.from)
    if (rel[e.from]) rel[e.from].pubsTo.add(e.to)
  }
  const tableCount = Object.keys(snap.store || {}).length

  const anchor = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200
    return { left: Math.min(r.right + 10, w - 340), top: Math.max(8, r.top) }
  }
  const showDomain = (e, d) => setTip({ domain: d, ...anchor(e) })
  const showHub = (e) => setTip({ domain: null, ...anchor(e) })

  return (
    <div className="arch-wrap">
      <div className="arch-hub" onMouseEnter={showHub} onMouseLeave={() => setTip(null)}>
        <Icon name="database" size={14} />
        <b>存储枢纽</b>
        <span className="arch-hub-meta">{tableCount} 张表 · 写权随目录 · 悬停看归属</span>
      </div>

      <div className="arch-legend">
        圆点色 = 域 · ↓ 订阅自 = 我订阅谁 · ↑ 发布到 = 谁订阅我 · 悬停卡片看完整 topic
      </div>

      <div className="arch-grid">
        {Object.entries(snap.domains)
          .sort((a, b) => {
            const ra = rel[a[0]], rb = rel[b[0]]
            const sa = relLines(ra?.subsFrom) + relLines(ra?.pubsTo)
            const sb = relLines(rb?.subsFrom) + relLines(rb?.pubsTo)
            return sb - sa
          })
          .map(([d, info]) => {
          const r = rel[d] || { subsFrom: new Set(), pubsTo: new Set() }
          const subs = [...r.subsFrom], pubs = [...r.pubsTo]
          return (
            <div key={d} className={`arch-card${isHot(d) ? ' hot' : ''}`}
                 onMouseEnter={(e) => showDomain(e, d)} onMouseLeave={() => setTip(null)}>
              <div className="arch-head">
                <span className="arch-dot" style={{ background: domainColor(d) }} />
                <b>{d}</b>
                <span className={`arch-kind arch-kind-${info.kind || 'local'}`}>
                  {info.kind || 'local'}
                </span>
                <span className="arch-count">
                  发 {info.publishes.length} · 订 {Object.keys(info.subscribes).length}
                </span>
              </div>
              <div className="arch-rel">
                <span className="arch-rel-label">↓ 订阅自</span>
                {subs.length
                  ? subs.map(x => (
                      <span key={x} className="arch-rel-item">
                        <i style={{ background: domainColor(x) }} />{x}
                      </span>
                    ))
                  : <span className="arch-empty">—</span>}
              </div>
              <div className="arch-rel">
                <span className="arch-rel-label">↑ 发布到</span>
                {pubs.length
                  ? pubs.map(x => (
                      <span key={x} className="arch-rel-item">
                        <i style={{ background: domainColor(x) }} />{x}
                      </span>
                    ))
                  : <span className="arch-empty">—</span>}
              </div>
            </div>
          )
        })}
      </div>

      {tip && createPortal(
        tip.domain
          ? <ArchTip snap={snap} domain={tip.domain} left={tip.left} top={tip.top} />
          : <HubTip store={snap.store} left={tip.left} top={tip.top} />,
        document.body
      )}
    </div>
  )
}

// 通用 tooltip 外壳:固定定位(portal 到 body),标题 + 内容 + 可选脚注
function Tip({ left, top, name, footer, children }) {
  return (
    <div className="arch-tip" style={{ left, top }}>
      {name && <div className="arch-tip-name">{name}</div>}
      {children}
      {footer && <div className="arch-tip-note">{footer}</div>}
    </div>
  )
}

// topic 行(可选槽位后缀 / pub 高亮色)
function TopicRow({ t, slot, pub }) {
  return <div className={`arch-tip-topic${pub ? ' pub' : ''}`}>{t}{slot ? <em>· {slot}</em> : null}</div>
}

function ArchTip({ snap, domain, left, top }) {
  const info = snap.domains[domain] || {}
  const pubs = info.publishes || []
  const subs = Object.entries(info.subscribes || {})
  return (
    <Tip left={left} top={top}
         name={<><span className="arch-dot" style={{ background: domainColor(domain) }} />{domain}</>}>
      <div className="arch-tip-label">发布 {pubs.length}</div>
      {pubs.length ? pubs.map(t => <TopicRow key={t} t={t} pub />) : <div className="arch-tip-empty">—</div>}
      <div className="arch-tip-label">订阅 {subs.length}</div>
      {subs.length ? subs.map(([t, slot]) => <TopicRow key={t} t={t} slot={slot} />) : <div className="arch-tip-empty">—</div>}
    </Tip>
  )
}

function HubTip({ store, left, top }) {
  const groups = {}
  for (const [table, info] of Object.entries(store || {})) {
    const owner = info?.owner || 'kernel'
    if (!groups[owner]) groups[owner] = []
    groups[owner].push({ table, info })
  }
  const total = Object.keys(store || {}).length
  return (
    <Tip left={left} top={top} name={<><Icon name="database" size={14} />存储枢纽</>}
         footer="读 = 全域开放(hub.read),不区分谁读">
      <div className="arch-tip-label">{total} 张表 · 写权随目录</div>
      {Object.entries(groups).map(([owner, tables]) => (
        <div key={owner} className="arch-tip-group">
          <div className="arch-tip-owner">
            <span className="arch-dot" style={{ background: domainColor(owner) }} />{owner}
            <span className="arch-tip-n">写 {tables.length} 表</span>
          </div>
          {tables.map(({ table, info }) => (
            <div key={table} className="arch-tip-topic">{table} <em>{info?.type || '?'} · {info?.rows ?? 0} 行</em></div>
          ))}
        </div>
      ))}
    </Tip>
  )
}

// 环形图边的悬停详情:该方向上的 topic 列表
function EdgeTip({ from, to, topics, left, top }) {
  return (
    <Tip left={left} top={top} name={`${from} → ${to}`}>
      <div className="arch-tip-label">{topics.length} 个 topic</div>
      {topics.map(t => <TopicRow key={t} t={t} />)}
    </Tip>
  )
}

/* ═══════════════ 入口:视图切换 ═══════════════ */

export default function TopologyGraph({ snap, lastMsg, view }) {
  return view === 'ring'
    ? <RingGraph snap={snap} lastMsg={lastMsg} />
    : <CardGraph snap={snap} lastMsg={lastMsg} />
}
