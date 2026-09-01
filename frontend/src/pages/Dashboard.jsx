// 系统总览(重设计):页头 + KPI 六宫格 + 左主右辅双栏面板。数据逻辑与旧版一致
// (通用端点 + SSE 去抖刷新),只重排信息架构与视觉——组件化类 + 统一 SVG 图标。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { hubSnapshot, hubStore } from '../api/hub'
import { useHubEvent } from '../hooks/HubStream'
import LiveElapsed from '../components/LiveElapsed'
import Icon from '../components/Icon'
import Kpi from '../components/Kpi'
import { P_LABEL } from './PublishAccounts'

// 监控源 → 发布账号 绑定矩阵(行=频道,列=账号,●=已绑)。数据全走通用查询,零后端。
function BindingMatrix({ channels, accounts, bindings }) {
  // 绑定存 targets 边对象数组 [{connection_id,...}];兼容旧 connection_ids 裸 id 行
  const byChannel = Object.fromEntries(
    bindings.map(b => {
      const edges = b.data?.targets || (b.data?.connection_ids || []).map(id => ({ connection_id: String(id) }))
      return [b.data?.channel_id, new Set(edges.map(t => String(t.connection_id)))]
    }))
  const acctLabel = (a) => {
    const plat = (a.provider || '').replace('engine_', '')
    return `${P_LABEL[plat] || plat}·${a.nickname || a.display_name || a.id}`
  }
  const platColor = { douyin: '#26c6da', kuaishou: '#ff5000', bilibili: '#fb7299',
                      xiaohongshu: '#ff2442', shipinhao: '#fa9d3b' }
  if (!channels.length || !accounts.length) return null
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <Icon name="link" size={16} />
        <span className="panel-title">监控源 → 发布账号(绑定矩阵)</span>
        <span className="text-muted" style={{ fontSize: 11 }}>
          频道发现新视频 → 自动发到打勾的账号
        </span>
      </div>
      <div className="panel-body flush" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: 200 }} />
            {accounts.map(a => <col key={a.id} />)}
          </colgroup>
          <thead>
            <tr className="text-muted">
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>监控源＼账号</th>
              {accounts.map(a => (
                <th key={a.id} title={acctLabel(a)}
                    style={{ padding: '6px 8px', fontSize: 11, textAlign: 'left', borderLeft: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <span style={{ color: platColor[(a.provider || '').replace('engine_', '')], flexShrink: 0 }}>●</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acctLabel(a)}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map(ch => {
              const bound = byChannel[ch.channel_id] || new Set()
              return (
                <tr key={ch.channel_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 12px', whiteSpace: 'nowrap', overflow: 'hidden',
                               textOverflow: 'ellipsis', fontWeight: bound.size ? 600 : 400,
                               color: bound.size ? undefined : 'var(--gray-500)' }}
                      title={ch.channel_name || ch.channel_id}>
                    {ch.channel_name || ch.channel_id}
                  </td>
                  {accounts.map(a => (
                    <td key={a.id} style={{ textAlign: 'center', padding: '6px 8px', borderLeft: '1px solid var(--border)' }}>
                      {bound.has(String(a.id))
                        ? <span style={{ color: '#16a34a', fontWeight: 700 }}>●</span>
                        : <span style={{ color: 'var(--border)' }}>·</span>}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const STATUS_COLOR = {
  running: '#f59e0b', queued: '#38bdf8', succeeded: '#34d399',
  failed: '#f87171', cancelled: '#8b99b4', idle: '#6b7a94',
}
const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '—'
const today = () => new Date().toISOString().slice(0, 10)
const fmtDur = (s) => {
  s = Math.max(0, Math.round(s))
  return s >= 3600 ? `${Math.floor(s / 3600)}h${Math.floor(s % 3600 / 60)}m`
    : s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}

export default function Dashboard() {
  const [jobs, setJobs] = useState([])
  const [channels, setChannels] = useState([])
  const [videosToday, setVideosToday] = useState(0)
  const [snap, setSnap] = useState(null)
  const [incidents, setIncidents] = useState([])
  const [ytAuth, setYtAuth] = useState(null)
  const [pubAccounts, setPubAccounts] = useState([])
  const [bindings, setBindings] = useState([])
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
      const [{ data: j }, { data: ch }, { data: vd }, { data: sn }, { data: inc }] =
        await Promise.all([
          hubStore('scheduler_jobs', { order: 'id:desc', limit: 200 }),
          hubStore('daemons_channels', { limit: 100 }),
          hubStore('daemons_videos', { discovered_at_gte: dayStart.getTime() / 1000, limit: 200 }),
          hubSnapshot(),
          hubStore('sentinel_incidents', { status: 'open', limit: 20 })
            .catch(() => ({ data: { rows: [] } })),
        ])
      setJobs(j.rows); setChannels(ch.rows); setVideosToday(vd.count)
      setSnap(sn); setIncidents(inc.rows); setError('')
      const [{ data: conns }, { data: bnd }] = await Promise.all([
        hubStore('platform_adapters_connections', { kind: 'connection', limit: 100 })
          .catch(() => ({ data: { rows: [] } })),
        hubStore('scheduler_channel_targets', { kind: 'targets', limit: 200 })
          .catch(() => ({ data: { rows: [] } })),
      ])
      const rows = conns?.rows || []
      setPubAccounts(rows.filter(r => (r.data?.provider || '').startsWith('engine_'))
        .map(r => ({ id: r.id, ...r.data })))
      setBindings(bnd?.rows || [])
      const ytRow = (rows.find(r => r.data?.provider === 'youtube') || {}).data
      setYtAuth(ytRow ? {
        connected: !!ytRow.meta?.connected, expired: !!ytRow.meta?.expired,
        has_refresh: !!ytRow.meta?.has_refresh, updated_at: ytRow.meta?.updated_at,
      } : null)
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  useHubEvent('msg', (m) => {                        // 管线/哨兵事件 → 去抖刷新
    if (!m.topic?.startsWith('scheduler/') && !m.topic?.startsWith('sentinel/')) return
    if (timerRef.current) return
    timerRef.current = setTimeout(() => { timerRef.current = null; load() }, 500)
  })

  const count = (st) => jobs.filter(r => r.status === st).length
  // 已完成 = 现存任务总数(snapshot 存储枢纽行数;删任务=物理删行,故总行数即现存总数)
  // 减去其余各状态。running/queued/failed/cancelled/idle 都远小于 limit,前端数得准;
  // succeeded 超 200 条时直接在 limit 200 里数会漏历史,故用总行数反推。
  const totalJobs = snap?.store?.scheduler_jobs?.rows ?? jobs.length
  const succeeded = Math.max(0, totalJobs
    - count('running') - count('queued') - count('failed')
    - count('cancelled') - count('idle'))
  const active = jobs.filter(r => r.status === 'running' || r.status === 'queued')
  const stats = snap?.stats || {}
  const journal = snap?.journal || {}
  const healthy = (journal.dead ?? 0) === 0 && incidents.length === 0

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">系统总览</div>
          <div className="page-sub">跨域聚合:任务 · 监控 · 发布 · 总线健康</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={load}><Icon name="refresh" size={14} /> 刷新</button>
      </div>

      {error && <div className="alert alert-error"><Icon name="alert" size={14} /> {error}</div>}

      <div className="kpi-grid">
        <Kpi icon="play" tone={STATUS_COLOR.running} value={count('running')} label="执行中" />
        <Kpi icon="hourglass" tone={STATUS_COLOR.queued} value={count('queued')} label="排队中" />
        <Kpi icon="check" tone={STATUS_COLOR.succeeded} value={succeeded} label="已完成" />
        <Kpi icon="x" tone={STATUS_COLOR.failed} value={count('failed')} label="失败" />
        <Kpi icon="antenna" tone="#38bdf8" value={channels.length} label="监控频道" sub={`今日发现 ${videosToday} 条`} />
        <Kpi icon="shield" tone={healthy ? '#34d399' : '#f87171'}
             value={healthy ? '正常' : '告警'} label="系统健康"
             sub={`死信 ${journal.dead ?? 0} · 在途 ${journal.pending ?? 0}`} />
      </div>

      <div className="dash-grid">
        {/* ── 左列:主流程 ── */}
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <Icon name="video" size={16} />
              <span className="panel-title">YouTube 数据源</span>
              <span className="text-muted" style={{ fontSize: 12 }}>
                {ytAuth?.connected
                  ? (ytAuth?.expired
                      ? (ytAuth?.has_refresh ? 'Token 已过期,轮询时自动刷新' : 'Token 已过期且无刷新凭据,请重新连接')
                      : '视频采集 API 已连接')
                  : '采集视频用的 OAuth 连接(未授权)'}
              </span>
              <button className={`btn btn-sm ${ytAuth?.connected ? 'btn-outline' : 'btn-primary'}`}
                      style={{ marginLeft: 'auto' }}
                      onClick={() => window.open('/api/auth/youtube/authorize', '_blank', 'width=600,height=700')}>
                {ytAuth?.connected ? '重新连接' : <><Icon name="link" size={13} /> 连接</>}
              </button>
            </div>
            {ytAuth?.updated_at && (
              <div className="panel-body" style={{ padding: '10px 16px' }}>
                <span className="text-muted" style={{ fontSize: 11 }}>
                  更新于 {new Date(ytAuth.updated_at).toLocaleString('zh-CN', { hour12: false })}
                </span>
              </div>
            )}
          </div>


          <div className="panel fill">
            <div className="panel-head">
              <Icon name="play" size={16} />
              <span className="panel-title">进行中 / 排队({active.length})</span>
              <Link to="/jobs" className="panel-action">全部任务 →</Link>
            </div>
            <div className="panel-body flush">
              {active.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><Icon name="play" size={34} /></div>
                  <div>当前空闲——没有执行中或排队的任务</div>
                </div>
              ) : active.map(r => (
                <div key={r.id} style={{ padding: '11px 16px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                    <span className="status-dot pulse" style={{ color: STATUS_COLOR[r.status] }}>
                      {r.status === 'running' ? '执行中' : '排队中'}
                    </span>
                    <span className="text-mono text-muted">{(r.job_id || '').slice(0, 8)}</span>
                    <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.video_url}>
                      {r.video_url}
                    </span>
                    <span className="text-muted" style={{ fontSize: 11 }}>{r.task_type}</span>
                  </div>
                  {r.status === 'running' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                      <span className="mini-progress running"><i style={{ width: `${Math.min(100, r.progress || 0)}%` }} /></span>
                      <span className="text-muted" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {Math.round(r.progress || 0)}% {r.progress_message} · <LiveElapsed anchor={r.started_at} render={fmtDur} />
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 右列:健康与账号 ── */}
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <Icon name="network" size={16} />
              <span className="panel-title">总线</span>
              <Link to="/observatory" className="panel-action">观测台 →</Link>
            </div>
            <div className="panel-body flush">
              {[
                ['域', '已挂载的业务域', snap ? Object.keys(snap.domains || {}).length : '—', false],
                ['发布', '本次启动以来发出的消息', stats.published ?? '—', false],
                ['投递', '分发到订阅者的次数(一发可多投)', stats.delivered ?? '—', false],
                ['重试', '处理器抛错的退避重投', stats.retried ?? 0, false],
                ['死信', '账本中积压待处理(可重放或销账)', snap?.journal?.dead ?? 0, Number(snap?.journal?.dead ?? 0) > 0],
              ].map(([label, desc, value, bad]) => (
                <div className="list-row" key={label}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{label}</div>
                    <div className="text-muted" style={{ fontSize: 11, lineHeight: 1.35 }}>{desc}</div>
                  </div>
                  <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700,
                                 color: bad ? 'var(--danger)' : undefined, fontVariantNumeric: 'tabular-nums' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <Icon name="alert" size={16} />
              <span className="panel-title">哨兵事件</span>
              <Link to="/observatory" className="panel-action">观测台 →</Link>
            </div>
            <div className="panel-body flush">
              {incidents.length === 0 ? (
                <div className="text-muted" style={{ padding: '18px 16px', fontSize: 12 }}>无未决事件</div>
              ) : incidents.map(i => (
                <div className="list-row" key={i.id} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 2 }}>
                  <div>
                    <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                      [{i.data?.severity}] {i.data?.rule}
                    </span>
                    <span className="text-muted" style={{ marginLeft: 6 }}>{i.data?.subject}</span>
                  </div>
                  {i.data?.detail && (
                    <div className="text-muted" style={{ fontSize: 11 }}>{i.data.detail}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <Icon name="send" size={16} />
              <span className="panel-title">发布账号({pubAccounts.length})</span>
              <Link to="/accounts" className="panel-action">账号管理 →</Link>
            </div>
            <div className="panel-body flush">
              {pubAccounts.length === 0 ? (
                <div className="text-muted" style={{ padding: '18px 16px', fontSize: 12 }}>
                  引擎未上报账号(上线即广播,每 30 分钟对账)
                </div>
              ) : pubAccounts.map(a => (
                <div className="list-row" key={a.access_token}>
                  <span className="text-muted" style={{ fontSize: 11 }}>{(a.provider || '').replace('engine_', '')}</span>
                  <span style={{ fontWeight: 600 }}>{a.nickname || a.display_name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <BindingMatrix channels={channels} accounts={pubAccounts} bindings={bindings} />
    </div>
  )
}
