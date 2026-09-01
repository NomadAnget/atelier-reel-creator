// 发布账号(新系统):发布引擎账号管理——纯总线形态,零引擎直连。
//   状态面:connections 台账(/api/store,引擎快照经 platform_adapters 落库),
//           登录态徽章来自 meta(引擎持久化缓存,不开浏览器);
//   控制面:web/engine/* 命令(登录/删除/重报)经网关投递引擎执行,
//           快照回流 → 台账更新 → SSE 驱动本页自动刷新;
//   活性:publishers 心跳(总线 recent 里 30s 内有心跳=引擎在线)。
import { useCallback, useEffect, useRef, useState } from 'react'
import { hubCommand, hubSnapshot, hubStore } from '../api/hub'
import { useHubEvent } from '../hooks/HubStream'
import { confirm } from '../components/confirm'
import Icon from '../components/Icon'

const PLATFORMS = ['douyin', 'kuaishou', 'xiaohongshu', 'shipinhao', 'bilibili']
const PLAT_COLOR = { douyin: '#26c6da', kuaishou: '#ff5000', xiaohongshu: '#ff2442', shipinhao: '#fa9d3b', bilibili: '#fb7299' }
export const P_LABEL = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书',
                  shipinhao: '视频号', bilibili: 'B站' }
const HEARTBEAT_FRESH_SEC = 30

const fmtAge = (ts) => {
  if (!ts) return '未检查'
  const m = Math.round((Date.now() / 1000 - ts) / 60)
  return m < 60 ? `${m}分钟前` : m < 1440 ? `${Math.round(m / 60)}小时前` : `${Math.round(m / 1440)}天前`
}

export default function PublishAccounts() {
  const [accounts, setAccounts] = useState([])     // connections engine_* 行
  const [engineUp, setEngineUp] = useState(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState('')             // 正在执行的命令提示
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const [{ data: conns }, { data: snap }] = await Promise.all([
        hubStore('platform_adapters_connections', { kind: 'connection', limit: 100 }),
        hubSnapshot(),
      ])
      setAccounts(conns.rows.map(r => r.data)
        .filter(d => (d?.provider || '').startsWith('engine_')))
      const hb = (snap.recent || []).filter(m => m.topic === 'publishers/health/heartbeat')
        .map(m => m.ts).sort((a, b) => b - a)[0]
      setEngineUp(!!hb && Date.now() / 1000 - hb < HEARTBEAT_FRESH_SEC)
      setError('')
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(load, 15000)            // 心跳新鲜度兜底刷新
    return () => clearInterval(t)
  }, [load])

  // 台账写事件/快照消息 → 去抖回读
  const trigger = () => {
    if (timerRef.current) return
    timerRef.current = setTimeout(() => { timerRef.current = null; load() }, 400)
  }
  useHubEvent('store', (m) => { if (String(m.table || '') === 'platform_adapters_connections') trigger() })
  useHubEvent('msg', (m) => { if (m.topic === 'publishers/accounts/snapshot') trigger() })

  const cmd = async (topic, payload, note) => {
    setBusy(note)
    try {
      await hubCommand(topic, payload)
      setError('')
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setTimeout(() => setBusy(''), 1200)
    }
  }

  const addAccount = (platform) => {
    setAdding(false)
    cmd('web/engine/login_requested', { platform },
        `已请求登录 ${P_LABEL[platform]}:引擎宿主机将弹出浏览器,请扫码;登录完成后账号自动出现`)
  }
  const relogin = (a) => cmd('web/engine/login_requested',
    { platform: a.provider.replace('engine_', ''), account_key: a.access_token },
    `重登 ${a.nickname}:复用原 profile,宿主机浏览器等扫码`)
  const remove = async (a) => {
    if (!(await confirm(`删除账号「${a.nickname}」?将移除引擎登录态(profile 数据),台账自动剪枝。`))) return
    cmd('web/engine/account_delete_requested', { key: a.access_token },
        `已请求删除 ${a.nickname}`)
  }

  const online = accounts.filter(a => a.meta?.logged_in).length

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">发布账号</div>
          <div className="page-sub">发布引擎账号 · 总线直投控制 · 心跳活性</div>
        </div>
      </div>

      {error && <div className="alert alert-error mb-24"><Icon name="alert" size={14} /> {error}</div>}
      {busy && <div className="alert mb-24" style={{ fontSize: 12 }}><Icon name="hourglass" size={13} /> {busy}</div>}

      {/* 引擎总状态(活性=心跳公约,总线上直接可见) */}
      <div className="panel mb-24">
        <div className="panel-head">
          <span className={`status-dot${engineUp ? ' pulse' : ''}`}
                style={{ color: engineUp ? 'var(--success)' : engineUp === null ? 'var(--gray-400)' : 'var(--danger)' }} />
          <span className="panel-title">
            发布引擎 {engineUp ? '在线' : engineUp === null ? '检测中…' : '离线'}
          </span>
        </div>
        <div className="panel-body">
          <div className="text-muted" style={{ fontSize: 11 }}>
            {engineUp
              ? 'publishers 远程域 · 心跳正常 · 浏览器自动化多平台直发'
              : '总线上 30s 内无引擎心跳——检查监督器日志(系统日志页 SUBPROC)'}
          </div>
        </div>
      </div>

      {/* 账号卡 */}
      <div className="panel mb-24">
        <div className="panel-head">
          <Icon name="send" size={15} />
          <span className="panel-title">已连接账号</span>
          <span className="text-muted" style={{ fontSize: 11 }}>
            {online}/{accounts.length} 在线(登录态为引擎缓存,非实时)
          </span>
          <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}
                  disabled={!engineUp}
                  onClick={() => cmd('web/engine/check_requested', {}, '已请求重报账号快照')}>
            <Icon name="refresh" size={13} /> 重报快照
          </button>
        </div>
        <div className="panel-body" style={{ display: 'grid', gap: 10,
                      gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {accounts.map(a => {
            const p = a.provider.replace('engine_', '')
            const li = a.meta?.logged_in
            return (
              <div key={a.access_token} className="card"
                   style={{ padding: '10px 12px', display: 'flex',
                            alignItems: 'center', gap: 10, minHeight: 74 }}>
                {a.meta?.avatar
                  ? <img src={a.meta.avatar} alt="" style={{ width: 28, height: 28,
                         borderRadius: '50%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 20, color: PLAT_COLOR[p] || 'var(--gray-400)' }}>●</span>}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.nickname || a.display_name}
                  </div>
                  <div className="text-muted" style={{ fontSize: 10 }}>
                    {P_LABEL[p] || p} · 检查于 {fmtAge(a.meta?.checked_at)}
                  </div>
                </div>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10,
                               fontWeight: 600,
                               color: li ? '#16a34a' : li == null ? '#b08900' : '#94a3b8',
                               border: `1px solid ${li ? '#16a34a' : li == null ? '#b08900' : '#94a3b8'}` }}>
                  {li ? '在线' : li == null ? '未知' : '离线'}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button className="btn btn-outline btn-sm" title="重登(复用原 profile)"
                          disabled={!engineUp} style={{ fontSize: 10, padding: '1px 6px' }}
                          onClick={() => relogin(a)}><Icon name="refresh" size={12} /></button>
                  <button className="btn btn-outline btn-sm" title="删除账号"
                          disabled={!engineUp} style={{ fontSize: 10, padding: '1px 6px',
                                                        color: '#dc2626' }}
                          onClick={() => remove(a)}><Icon name="x" size={12} /></button>
                </span>
              </div>
            )
          })}
          {/* 添加账号 */}
          <div className="card" style={{ padding: '10px 12px', minHeight: 74,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px dashed var(--gray-300, #444c56)',
                cursor: adding ? 'default' : 'pointer' }}
               onClick={() => { if (!adding) setAdding(true) }}>
            {adding ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: 5, width: '100%' }}>
                {PLATFORMS.map(p => (
                  <button key={p} className="btn btn-outline btn-sm" disabled={!engineUp}
                          style={{ fontSize: 10, padding: '3px 4px', minWidth: 0 }}
                          onClick={(e) => { e.stopPropagation(); addAccount(p) }}>
                    <span style={{ color: PLAT_COLOR[p] }}>●</span> {P_LABEL[p]}
                  </button>
                ))}
                <button className="btn btn-outline btn-sm"
                        style={{ fontSize: 10, padding: '3px 4px', minWidth: 0 }}
                        onClick={(e) => { e.stopPropagation(); setAdding(false) }}>收起</button>
              </div>
            ) : <span className="text-muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="plus" size={13} /> 添加账号</span>}
          </div>
        </div>
        <div className="panel-foot text-muted" style={{ fontSize: 10 }}>
          <span>添加/重登会在<b>引擎宿主机</b>弹出浏览器等扫码——人在机器旁再点。命令走总线持久投递,引擎离线时会挂账,上线自动补投。</span>
        </div>
      </div>

      <FailedPublishCard engineUp={engineUp} />
    </div>
  )
}

// 发布失败的任务:任务已成功(产物在盘)但发布出闸失败——重试只重走发布,不重跑管线。
// 数据 = scheduler_jobs(publish_status 非可滤列,取最近 200 行客户端过滤);
// 动作 = web/job/republish_requested;SSE(jobs 写事件/发布态遥测)驱动刷新。
function FailedPublishCard({ engineUp }) {
  const [rows, setRows] = useState([])
  const [busyId, setBusyId] = useState('')
  const [msg, setMsg] = useState('')
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const { data } = await hubStore('scheduler_jobs',
        { order: 'created_at:desc', limit: 200 })
      setRows((data.rows || []).filter(r => r.publish_status === 'failed'))
    } catch (e) { setMsg(e?.response?.data?.error || e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  const trigger = () => {
    if (timerRef.current) return
    timerRef.current = setTimeout(() => { timerRef.current = null; load() }, 500)
  }
  useHubEvent('store', (m) => { if (m.table === 'scheduler_jobs') trigger() })
  useHubEvent('msg', (m) => { if (m.topic === 'scheduler/job/publish_state') trigger() })

  const retry = async (r) => {
    setBusyId(r.job_id); setMsg('')
    try {
      await hubCommand('web/job/republish_requested', { job_id: r.job_id })
      setMsg(`已请求重试发布 ${r.job_id.slice(0, 8)}(产物直发,不重跑管线)`)
    } catch (e) { setMsg(e?.response?.data?.error || e.message) }
    finally { setTimeout(() => setBusyId(''), 1500) }
  }
  const discard = async (r) => {
    if (!(await confirm(`丢弃任务 ${r.job_id.slice(0, 8)} 的发布?\n确认不再重试,`
                        + '此行从失败列表移除(任务与成片保留,仅放弃发布环节)。'))) return
    setBusyId(r.job_id); setMsg('')
    try {
      await hubCommand('web/job/publish_discard_requested', { job_id: r.job_id })
      setMsg(`已丢弃 ${r.job_id.slice(0, 8)} 的发布`)
    } catch (e) { setMsg(e?.response?.data?.error || e.message) }
    finally { setTimeout(() => setBusyId(''), 1500) }
  }

  if (rows.length === 0) return null
  return (
    <div className="panel mb-24">
      <div className="panel-head">
        <Icon name="alert" size={15} style={{ color: '#f59e0b' }} />
        <span className="panel-title" style={{ color: '#f59e0b' }}>发布失败的任务({rows.length})</span>
        <span className="text-muted" style={{ fontSize: 11 }}>任务已成片,仅发布环节失败——重试只重走发布出闸</span>
        {msg && <span className="text-muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{msg}</span>}
      </div>
      <div className="panel-body flush">
      {rows.map(r => {
        // 逐目标账本(publish_payload.targets):失败红/已发绿/待回流灰;
        // 重试只补失败与未回流目标,已发布平台被出闸幂等跳过(不重复投稿)
        let targets = {}
        try { targets = JSON.parse(r.publish_payload || '{}').targets || {} } catch { /* 旧行无账本 */ }
        const tEntries = Object.entries(targets)
        const tColor = (s) => s === 'published' ? '#16a34a' : s === 'failed' ? '#f85149' : '#8b949e'
        return (
          <div key={r.job_id} className="list-row" style={{ flexWrap: 'wrap', fontSize: 12 }}>
            <span style={{ fontFamily: 'monospace', flexShrink: 0 }} title={r.job_id}>
              {r.job_id.slice(0, 8)}
            </span>
            <span className="tag" style={{ flexShrink: 0, fontSize: 10 }}>
              {r.task_type === 'news_digest' ? '新闻日报' : '视频翻译'}
            </span>
            {tEntries.length > 0 && (
              <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {tEntries.map(([p, t]) => {
                  const acctLabel = t.account_name || t.account || ''
                  return (
                    <span key={p}
                          title={`${p}:${t.status}${acctLabel ? ` · ${acctLabel}` : ''}${t.detail ? ` — ${t.detail}` : ''}`}
                          style={{ fontSize: 10, padding: '0 6px', borderRadius: 8,
                                   border: `1px solid ${tColor(t.status)}`, color: tColor(t.status) }}>
                      {P_LABEL[p] || p}{acctLabel && ` · ${acctLabel}`}
                      {t.status === 'published' ? ' ✓' : t.status === 'failed' ? ' ✗' : ' …'}
                    </span>
                  )
                })}
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden',
                           textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={r.publish_error || ''}>
              <span style={{ color: '#f85149' }}>{r.publish_error || '(无错误详情)'}</span>
            </span>
            <span className="text-muted" style={{ flexShrink: 0 }}>{fmtAge(r.ended_at)}</span>
            <button className="btn btn-outline btn-sm" style={{ flexShrink: 0 }}
                    disabled={busyId === r.job_id || !engineUp}
                    title={engineUp ? '只补失败/未回流目标(已发布平台幂等跳过)' : '发布引擎离线'}
                    onClick={() => retry(r)}>
              {busyId === r.job_id ? <Icon name="hourglass" size={12} /> : <><Icon name="refresh" size={12} /> 重试</>}
            </button>
            <button className="btn btn-outline btn-sm"
                    style={{ flexShrink: 0, color: '#dc2626' }}
                    disabled={busyId === r.job_id}
                    title="确认不再重试,从失败列表移除(任务与成片保留)"
                    onClick={() => discard(r)}>
              <Icon name="x" size={12} /> 丢弃
            </button>
          </div>
        )
      })}
      </div>
    </div>
  )
}
