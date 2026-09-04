// 发布账号 · 绑定源近 30 天上传活跃度
// 每个发布账号(engine_* 连接)一张卡,30 个小方块 = 近 30 天;当天有**任一绑定监控源上传视频**
// (daemons_videos.published_at)= 绿,无 = 灰。自足取数:connections + channel_targets + daemons_videos。
// 展示的是监控源(YouTube 频道)自己的上传活跃度,与我们系统是否发布无关。
// 联动:选中某监控源(Monitor 的 filterChannel)→ 该源上传的天在其绑定账号卡里**橙色高亮**,
//       未绑该源的账号卡淡化。保鲜:接 SSE 'store' 事件,相关表写入即防抖重取。
import { useCallback, useEffect, useRef, useState } from 'react'
import { hubStore } from '../api/hub'
import { useHubEvent } from '../hooks/HubStream'
import { accountsToTargets, PLATFORM_LABEL } from './CreateJobModal'

const DAYS = 30
const DAY_MS = 86400000
const C_SEL = '#f59e0b'                 // 所选源上传(高亮)
const C_ANY = '#2ea043'                 // 有绑定源上传
const C_NONE = 'rgba(127,127,127,0.16)' // 无

export default function PublishActivity({ selectedChannel = '' }) {
  // accounts + agg(账号逐日聚合)+ chanDays(每频道逐日,供高亮)+ acctChans(账号→频道)
  const [d, setD] = useState({ accounts: [], agg: {}, chanDays: {}, acctChans: {} })
  const timer = useRef(null)

  const load = useCallback(async () => {
    try {
      const [{ data: cn }, { data: bt }, { data: vd }] = await Promise.all([
        hubStore('publishers_accounts', { kind: 'account', limit: 200 }),
        hubStore('scheduler_channel_targets', { limit: 500 }),
        hubStore('daemons_videos', { order: 'discovered_at:desc', limit: 2000 }),
      ])
      const accounts = accountsToTargets(cn.rows)

      // 账号 id → 绑定的 channel_id 列表(channel_targets 是信封表,字段在 .data)。
      // targets 为边对象数组 [{connection_id,...}];兼容旧 connection_ids 裸 id 行。
      const acctChans = {}
      for (const r of (bt.rows || [])) {
        const cid = r.data?.channel_id
        if (!cid) continue
        const edges = r.data?.targets || (r.data?.connection_ids || []).map(id => ({ connection_id: String(id) }))
        for (const t of edges) {
          const connId = t?.connection_id
          if (!connId) continue
          if (!acctChans[connId]) acctChans[connId] = []
          if (!acctChans[connId].includes(cid)) acctChans[connId].push(cid)
        }
      }

      // channel_id → 近 30 天逐日计数(published_at;daemons_videos 类型化表,字段扁平)
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const day0 = start.getTime() - (DAYS - 1) * DAY_MS
      const chanDays = {}
      for (const v of (vd.rows || [])) {
        if (!v.published_at) continue
        const idx = Math.floor((v.published_at * 1000 - day0) / DAY_MS)
        if (idx < 0 || idx >= DAYS) continue
        const cid = v.channel_id
        if (!chanDays[cid]) chanDays[cid] = new Array(DAYS).fill(0)
        chanDays[cid][idx]++
      }

      // 账号 → 其所有绑定源逐日求和
      const agg = {}
      for (const a of accounts) {
        const arr = new Array(DAYS).fill(0)
        for (const cid of (acctChans[a.id] || [])) {
          const cd = chanDays[cid]
          if (cd) for (let i = 0; i < DAYS; i++) arr[i] += cd[i]
        }
        agg[a.id] = arr
      }
      setD({ accounts, agg, chanDays, acctChans })
    } catch { /* 无发布账号/查询失败:静默不显示 */ }
  }, [])

  useEffect(() => { load() }, [load])

  useHubEvent('store', (m) => {
    const t = String(m.table || '')
    if (t !== 'daemons_videos' && t !== 'scheduler_channel_targets'
        && t !== 'publishers_accounts') return
    if (timer.current) return
    timer.current = setTimeout(() => { timer.current = null; load() }, 600)
  })

  const { accounts, agg, chanDays, acctChans } = d
  if (!accounts.length) return null

  const dayLabel = (i) => new Date(
    new Date().setHours(0, 0, 0, 0) - (DAYS - 1 - i) * DAY_MS
  ).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })

  return (
    <div className="card mb-24">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>发布账号 · 绑定源近 30 天上传活跃度</span>
        <span className="text-muted" style={{ fontSize: 11 }}>
          绿=当天有绑定监控源上传 · 灰=无{selectedChannel ? ' · 橙=所选源上传' : ''}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 12,
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {accounts.map((a) => {
          const days = agg[a.id] || new Array(DAYS).fill(0)
          const bound = selectedChannel && (acctChans[a.id] || []).includes(selectedChannel)
          const selDays = bound ? (chanDays[selectedChannel] || null) : null
          const active = days.filter((c) => c > 0).length
          return (
            <div key={a.id} style={{ border: '1px solid var(--gray-300,#30363d)',
                                     borderRadius: 8, padding: 12,
                                     opacity: (selectedChannel && !bound) ? 0.4 : 1,
                                     transition: 'opacity .15s' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</div>
              <div className="text-muted" style={{ fontSize: 11, marginBottom: 10 }}>
                {PLATFORM_LABEL[a.platform] || a.platform} · 近 30 天 {active} 天有更新
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(15, 1fr)', gap: 3 }}>
                {days.map((c, i) => {
                  const sel = selDays ? (selDays[i] || 0) : 0
                  return (
                    <div key={i}
                         title={`${dayLabel(i)} · ${c} 条${sel > 0 ? ` · 所选源 ${sel} 条` : ''}`}
                         style={{ aspectRatio: '1 / 1', borderRadius: 2,
                                  background: sel > 0 ? C_SEL : c > 0 ? C_ANY : C_NONE }} />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
