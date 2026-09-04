// 发布账号(新系统):发布账号管理——纯总线形态,零引擎直连。
//   状态面:connections 台账(/api/store,publishers_accounts 经 platform_adapters 落库),
//           登录态徽章来自 meta(account_status 缓存,不开浏览器);
//   控制面:web/publishers/* 命令(登录/删除/重检)经网关投递 publishers 进程域执行,
//           account/changed 回流 → 台账更新 → SSE 驱动本页自动刷新;
//   发布域 = 按需进程域(发命令即由网关拉起子进程,无常驻引擎/心跳灯)。
import { useCallback, useEffect, useRef, useState } from 'react'
import { hubCommand, hubStore } from '../api/hub'
import { useHubEvent } from '../hooks/HubStream'
import { confirm } from '../components/confirm'
import Icon from '../components/Icon'

const PLATFORMS = ['douyin', 'kuaishou', 'xiaohongshu', 'shipinhao', 'bilibili']
const PLAT_COLOR = { douyin: '#26c6da', kuaishou: '#ff5000', xiaohongshu: '#ff2442', shipinhao: '#fa9d3b', bilibili: '#fb7299' }
export const P_LABEL = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书',
                  shipinhao: '视频号', bilibili: 'B站' }

const fmtAge = (ts) => {
  if (!ts) return '未检查'
  const m = Math.round((Date.now() / 1000 - ts) / 60)
  return m < 60 ? `${m}分钟前` : m < 1440 ? `${Math.round(m / 60)}小时前` : `${Math.round(m / 1440)}天前`
}

export default function PublishAccounts() {
  const [accounts, setAccounts] = useState([])     // 合并:publishers_accounts(身份)+ publishers_account_status(登录态)
  const [engineUp, setEngineUp] = useState(null)   // 就绪(系统可达)——publishers 是按需进程域,无常驻心跳
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState('')             // 正在执行的命令提示
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      // **单一真源**:直读 publishers 进程域直写的两张表(身份 + 登录态),按 key 合并——
      // 已去掉旧 platform_adapters engine_ 镜像(双存+滞后是先前 checked_at 陈旧的根因)。
      const [{ data: accs }, { data: sts }] = await Promise.all([
        hubStore('publishers_accounts', { kind: 'account', limit: 100 }),
        hubStore('publishers_account_status', { kind: 'status', limit: 100 }),
      ])
      const status = Object.fromEntries((sts.rows || []).map(r => [r.data.account_key, r.data]))
      setAccounts((accs.rows || []).map(r => {
        const d = r.data, st = status[d.key] || {}
        return { key: d.key, platform: d.platform, account_id: d.account_id,
                 name: d.name || d.account_id, avatar: d.avatar,
                 logged_in: st.logged_in, checked_at: st.checked_at }
      }))
      setEngineUp(true)
      setError('')
    } catch (e) {
      setEngineUp(false)
      setError(e?.response?.data?.error || e.message)
    }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(load, 15000)            // 兜底刷新(SSE 之外的定时回读)
    return () => clearInterval(t)
  }, [load])

  // 表写事件 / account/changed 事件 → 去抖回读
  const trigger = () => {
    if (timerRef.current) return
    timerRef.current = setTimeout(() => { timerRef.current = null; load() }, 400)
  }
  useHubEvent('store', (m) => {
    const t = String(m.table || '')
    if (t === 'publishers_accounts' || t === 'publishers_account_status') trigger()
  })
  useHubEvent('msg', (m) => { if (m.topic === 'publishers/account/changed') trigger() })

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
    cmd('web/publishers/login_requested', { platform },
        `已请求登录 ${P_LABEL[platform]}:宿主机将弹出浏览器,请扫码;登录完成后账号自动出现`)
  }
  const relogin = (a) => cmd('web/publishers/login_requested',
    { platform: a.platform, account_key: a.key },
    `重登 ${a.name}:复用原 profile,宿主机浏览器等扫码`)
  const remove = async (a) => {
    if (!(await confirm(`删除账号「${a.name}」?将移除登录态与 profile 数据。`))) return
    cmd('web/publishers/account_delete_requested', { account_key: a.key },
        `已请求删除 ${a.name}`)
  }

  const online = accounts.filter(a => a.logged_in).length

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

      {/* 发布域状态:按需进程域——发命令即由网关拉起子进程执行,无常驻引擎/心跳 */}
      <div className="panel mb-24">
        <div className="panel-head">
          <span className={`status-dot${engineUp ? ' pulse' : ''}`}
                style={{ color: engineUp ? 'var(--success)' : engineUp === null ? 'var(--gray-400)' : 'var(--danger)' }} />
          <span className="panel-title">
            发布域 {engineUp ? '就绪' : engineUp === null ? '检测中…' : '不可达'}
          </span>
        </div>
        <div className="panel-body">
          <div className="text-muted" style={{ fontSize: 11 }}>
            {engineUp
              ? 'publishers 进程域 · 按需拉起子进程(浏览器自动化多平台直发)· 闲时自动回收'
              : '系统不可达——检查后端是否运行(系统日志页)'}
          </div>
        </div>
      </div>

      {/* 账号卡 */}
      <div className="panel mb-24">
        <div className="panel-head">
          <Icon name="send" size={15} />
          <span className="panel-title">已连接账号</span>
          <span className="text-muted" style={{ fontSize: 11 }}>
            {online}/{accounts.length} 在线(登录态=account_status 缓存;点重新检查现场刷新)
          </span>
          <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}
                  disabled={!engineUp}
                  onClick={() => cmd('web/publishers/check_requested', {}, '已请求重新检查登录态')}>
            <Icon name="refresh" size={13} /> 重新检查
          </button>
        </div>
        <div className="panel-body" style={{ display: 'grid', gap: 10,
                      gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {accounts.map(a => {
            const p = a.platform
            const li = a.logged_in
            return (
              <div key={a.key} className="card"
                   style={{ padding: '10px 12px', display: 'flex',
                            alignItems: 'center', gap: 10, minHeight: 74 }}>
                {a.avatar
                  ? <img src={a.avatar} alt="" style={{ width: 28, height: 28,
                         borderRadius: '50%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 20, color: PLAT_COLOR[p] || 'var(--gray-400)' }}>●</span>}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.name}
                  </div>
                  <div className="text-muted" style={{ fontSize: 10 }}>
                    {P_LABEL[p] || p} · 检查于 {fmtAge(a.checked_at)}
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
