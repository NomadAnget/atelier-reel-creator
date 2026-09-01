// 监控源(新系统):统一登记入口(任务类型切换参数)+ 一张表一行一源。
//   视频翻译源 = YouTube 频道(daemons_channels,发现新视频→建翻译任务);
//   新闻日报源 = RSS/热榜/searxng 引擎(daemons_digest_sources,一行一源,采集时汇集去重)。
// 频道另有绑定:任务类型(channel_edit)+ 发布目标(scheduler_channel_targets,发布时读)。
// 命令 fire-and-forget(202+msg_id),SSE 存储事件驱动刷新兜底。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { hubStore, hubCommand, hubSnapshot } from '../api/hub'
import { useHubEvent } from '../hooks/HubStream'
import { connectionsToTargets, PLATFORM_LABEL } from '../components/CreateJobModal'
import { confirm } from '../components/confirm'
import DomainCombo from '../components/DomainCombo'
import useDomains from '../hooks/useDomains'
import Thumb from '../components/Thumb'
import PublishActivity from '../components/PublishActivity'
import Icon from '../components/Icon'
import TargetPicker, { DEFAULT_TARGET } from '../components/TargetPicker'

const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '—'
const durText = (sec) => {
  if (!sec) return '—'
  const m = Math.floor(sec / 60), s = sec % 60
  return m ? `${m}m${s}s` : `${s}s`
}
const watchUrl = (vid) => `https://www.youtube.com/watch?v=${vid}`
const PLAT_COLOR = { douyin: '#26c6da', kuaishou: '#ff5000', bilibili: '#fb7299',
  xiaohongshu: '#ff2442', shipinhao: '#fa9d3b' }

const newsKeyOfSource = (d) => {
  if (!d) return null
  if (d.kind === 'hotlist') return `hotlist:${d.value}`
  try { return `rss:${new URL(d.value).host}` } catch { return null }
}
const newsKeyOfItem = (it) => {
  const ch = String(it.channel || '')
  return ch.startsWith('hotlist:') ? ch : `rss:${it.source || ''}`
}

const DIGEST_KINDS = [
  ['rss', 'RSS · 国内', 'https://…/rss'],
  ['rss_intl', 'RSS · 海外', 'https://…/rss'],
  ['hotlist', '热榜', ''],
]
const KIND_LABEL = Object.fromEntries(DIGEST_KINDS.map(([k, l]) => [k, l]))
const KIND_PH = Object.fromEntries(DIGEST_KINDS.map(([k, , p]) => [k, p]))
const HOTLIST_BOARDS = [['baidu', '百度热搜'], ['toutiao', '头条热榜'],
  ['bilibili', 'B站热门'], ['hackernews', 'HackerNews']]
const HOTLIST_NAME = Object.fromEntries(HOTLIST_BOARDS.map(([v, l]) => [v, l]))
const POLL_OPTS = [[900, '15 分钟'], [1800, '30 分钟'], [3600, '1 小时'],
  [7200, '2 小时'], [21600, '6 小时'], [86400, '24 小时']]
const DUR_OPTS = [[10, '≤10 分钟'], [20, '≤20 分钟'], [30, '≤30 分钟'], [60, '≤60 分钟']]

// 统一登记入口:选任务类型 → 表单字段随之切换,提交到对应命令
function AddSourceForm({ typeLabels, domains = [], langOptions = [], onSubmitted }) {
  const [taskType, setTaskType] = useState('video_translate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ch, setCh] = useState({ channel_input: '', channel_name: '', auto_job: false,
                                 poll_interval: 3600, max_duration: '', domain: '', target_lang: '' })
  const [dg, setDg] = useState({ kind: 'rss', value: '', name: '' })
  const setChF = (k, v) => setCh(f => ({ ...f, [k]: v }))
  const setDgF = (k, v) => setDg(f => ({ ...f, [k]: v }))
  const label = (t) => typeLabels[t] || (t === 'video_translate' ? '视频翻译' : '新闻日报')

  const submit = async (e) => {
    e.preventDefault(); setError('')
    if (taskType === 'video_translate' && !ch.channel_input.trim())
      return setError('请输入频道地址 / @handle / UC频道ID')
    if (taskType === 'news_digest' && !dg.value.trim())
      return setError('请输入源地址 / 名称')
    setBusy(true)
    try {
      if (taskType === 'video_translate') {
        await hubCommand('web/monitor/channel_add_requested', {
          channel_input: ch.channel_input.trim(), channel_name: ch.channel_name.trim(),
          auto_job: ch.auto_job, poll_interval: Number(ch.poll_interval) || 3600,
          max_duration: String(ch.max_duration || ''), task_type: 'video_translate',
          domain: ch.domain.trim(), target_lang: ch.target_lang })
        setCh({ channel_input: '', channel_name: '', auto_job: false,
                poll_interval: 3600, max_duration: '', domain: '', target_lang: '' })
      } else {
        await hubCommand('web/monitor/digest_source_add_requested', {
          kind: dg.kind, value: dg.value.trim(), name: dg.name.trim() })
        setDg({ kind: dg.kind, value: '', name: '' })
      }
      onSubmitted?.()
    } catch (err) {
      setError(err?.response?.data?.error || err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="panel mb-16">
      <div className="panel-head">
        <Icon name="plus" size={15} />
        <span className="panel-title">登记监控源</span>
        <span className="text-muted" style={{ fontSize: 11 }}>选择任务类型,字段随之切换</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" style={{ width: 118 }} value={taskType}
                title="监控源的任务类型——字段随之切换"
                onChange={e => { setTaskType(e.target.value); setError('') }}>
          {['video_translate', 'news_digest'].map(t => (
            <option key={t} value={t}>{label(t)}</option>
          ))}
        </select>
        {taskType === 'video_translate' ? (
          <>
            <input className="input" style={{ flex: '2 1 220px' }} placeholder="频道 URL / @handle / UC…"
                   value={ch.channel_input} onChange={e => setChF('channel_input', e.target.value)} />
            <input className="input" style={{ flex: '1 1 110px' }} placeholder="备注名(选填)"
                   value={ch.channel_name} onChange={e => setChF('channel_name', e.target.value)} />
            <DomainCombo value={ch.domain} onChange={v => setChF('domain', v)} options={domains}
                         placeholder="领域 slug(选填)" style={{ flex: '1 1 110px' }} />
            <select className="input" style={{ width: 118 }} value={ch.target_lang}
                    title="配音目标语言(空=跟随全局默认)"
                    onChange={e => setChF('target_lang', e.target.value)}>
              <option value="">语言·跟随全局</option>
              {langOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={ch.auto_job}
                     onChange={e => setChF('auto_job', e.target.checked)} />自动建任务
            </label>
            <select className="input" style={{ width: 108 }} value={ch.poll_interval}
                    onChange={e => setChF('poll_interval', e.target.value)}>
              {POLL_OPTS.map(([v, l]) => <option key={v} value={v}>每 {l}</option>)}
            </select>
            <select className="input" style={{ width: 118 }} value={ch.max_duration}
                    onChange={e => setChF('max_duration', e.target.value)}>
              <option value="">时长不限</option>
              {DUR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </>
        ) : (
          <>
            <select className="input" style={{ width: 130 }} value={dg.kind}
                    onChange={e => setDg({ kind: e.target.value, value: '', name: '' })}>
              {DIGEST_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {dg.kind === 'hotlist' ? (
              <select className="input" style={{ flex: '2 1 240px' }} value={dg.value}
                      onChange={e => setDgF('value', e.target.value)}>
                <option value="">选择热榜板…</option>
                {HOTLIST_BOARDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <input className="input" style={{ flex: '2 1 240px' }} placeholder={KIND_PH[dg.kind]}
                     value={dg.value} onChange={e => setDgF('value', e.target.value)} />
            )}
            <input className="input" style={{ flex: '1 1 110px' }} placeholder="备注(选填)"
                   value={dg.name} onChange={e => setDgF('name', e.target.value)} />
          </>
        )}
        <button className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? '提交中…' : <><Icon name="plus" size={13} /> 登记源</>}
        </button>
        {error && <span style={{ color: '#dc2626', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="alert" size={13} /> {error}</span>}
      </div>
    </form>
  )
}

// 源配置弹窗(按任务类型切内容):视频=自动建任务/轮询/时长/发布目标;日报=启用/备注。
const fieldLabel = (t) => (
  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>{t}</label>
)
function ConfigModal({ source, type, accounts, domains = [], langOptions = [], bound, onClose, onSaved }) {
  const isVideo = type === 'video'
  const [v, setV] = useState(isVideo
    ? { auto_job: !!source.auto_job, poll_interval: source.poll_interval || 3600,
        max_duration: source.max_duration_minutes ?? '', domain: source.domain || '',
        target_lang: source.target_lang || '' }
    : { enabled: source.data.enabled !== false, name: source.data.name || '',
        poll_interval: source.data.poll_interval || 3600 })
  // sel = [{connection_id, visibility, declaration}];每条边一份发布设置(同账号跨频道可各异)
  const [sel, setSel] = useState(() => (bound || []).map(t => ({
    connection_id: String(t.connection_id),
    visibility: t.visibility || DEFAULT_TARGET.visibility,
    declaration: t.declaration ?? DEFAULT_TARGET.declaration })))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const setF = (k, val) => setV(s => ({ ...s, [k]: val }))

  const save = async () => {
    setBusy(true); setErr('')
    try {
      if (isVideo) {
        await hubCommand('web/monitor/channel_edit_requested', {
          channel_id: source.channel_id,
          values: { auto_job: v.auto_job, poll_interval: Number(v.poll_interval),
                    max_duration_minutes: v.max_duration === '' ? 'all' : Number(v.max_duration),
                    domain: v.domain.trim(), target_lang: v.target_lang } })
        await hubCommand('web/channel/targets_edit_requested', {
          channel_id: source.channel_id, targets: sel })
      } else {
        await hubCommand('web/monitor/digest_source_edit_requested', {
          source_id: source.id,
          values: { enabled: v.enabled, name: v.name.trim(),
                    poll_interval: Number(v.poll_interval) || 3600 } })
      }
      onSaved()
    } catch (e) { setErr(e?.response?.data?.error || e.message); setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">配置 · {isVideo ? '视频翻译' : '新闻日报'}</div>
        <div className="text-muted" style={{ fontSize: 11, marginBottom: 16, wordBreak: 'break-all' }}>
          {isVideo ? (source.channel_name || source.channel_id) : source.data.value}
        </div>

        {isVideo ? (
          <>
            <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center',
                            cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={v.auto_job}
                     onChange={e => setF('auto_job', e.target.checked)} />
              自动建任务(发现新视频即建翻译任务)
            </label>
            <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px' }}>
                {fieldLabel('轮询间隔')}
                <select className="input" style={{ width: '100%' }} value={v.poll_interval}
                        onChange={e => setF('poll_interval', e.target.value)}>
                  {POLL_OPTS.map(([val, l]) => <option key={val} value={val}>每 {l}</option>)}
                </select>
              </div>
              <div style={{ flex: '1 1 160px' }}>
                {fieldLabel('时长上限')}
                <select className="input" style={{ width: '100%' }} value={v.max_duration}
                        onChange={e => setF('max_duration', e.target.value)}>
                  <option value="">时长不限</option>
                  {DUR_OPTS.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              {fieldLabel('领域 slug(术语库按此匹配;空=通用池)')}
              <DomainCombo value={v.domain} onChange={val => setF('domain', val)} options={domains}
                           placeholder="选填,如 star-citizen" />
            </div>
            <div style={{ marginBottom: 14 }}>
              {fieldLabel('配音目标语言(空=跟随全局默认)')}
              <select className="input" style={{ width: '100%' }} value={v.target_lang}
                      onChange={e => setF('target_lang', e.target.value)}>
                <option value="">跟随全局默认</option>
                {langOptions.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
              </select>
            </div>
            {fieldLabel(`发布目标(${sel.length} 个)· 可见性/声明按账号分别设定`)}
            <div style={{ marginBottom: 8 }}>
              <TargetPicker accounts={accounts} value={sel} onChange={setSel} />
            </div>
          </>
        ) : (
          <>
            <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center',
                            cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={v.enabled}
                     onChange={e => setF('enabled', e.target.checked)} />
              启用(停用后采集循环跳过此源,不删除)
            </label>
            <div style={{ marginBottom: 12 }}>
              {fieldLabel('采集间隔(后台循环按此节奏逐源入池)')}
              <select className="input" style={{ width: '100%' }} value={v.poll_interval}
                      onChange={e => setF('poll_interval', e.target.value)}>
                {POLL_OPTS.map(([val, l]) => <option key={val} value={val}>每 {l}</option>)}
              </select>
            </div>
            {fieldLabel('备注')}
            <input className="input" style={{ width: '100%' }} value={v.name}
                   placeholder="选填" onChange={e => setF('name', e.target.value)} />
          </>
        )}

        {err && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 10, display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="alert" size={13} /> {err}</div>}
        <div className="modal-footer">
          <button className="btn btn-outline btn-sm" onClick={onClose}>取消</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Monitor() {
  const [channels, setChannels] = useState([])
  const [digestSources, setDigestSources] = useState([])
  const [videos, setVideos] = useState([])
  const [latestNews, setLatestNews] = useState({})
  const [bindings, setBindings] = useState({})
  const [accounts, setAccounts] = useState([])
  const [typeLabels, setTypeLabels] = useState({ video_translate: '视频翻译', news_digest: '新闻日报' })
  const [langOptions, setLangOptions] = useState([])   // 目标语言下拉:同源自管线 create_spec(单一真相源)
  const [configFor, setConfigFor] = useState(null)
  const [filterChannel, setFilterChannel] = useState('')
  const [error, setError] = useState('')
  const { domains: domainOpts, reload: reloadDomains } = useDomains()  // 领域候选(频道域∪术语域)——共享单一来源
  const timerRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    hubSnapshot().then(({ data }) => {
      const tt = data?.task_types || {}
      if (Object.keys(tt).length) {
        setTypeLabels(prev => ({ ...prev, ...Object.fromEntries(
          Object.entries(tt).map(([t, s]) => [t, s.label || t])) }))
        const lf = (tt.video_translate?.fields || []).find(f => f.name === 'target_lang')
        setLangOptions((lf?.options || []).map(o => [o.value, o.label]))   // 管线选项 → [v,l]
      }
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    try {
      const [{ data: ch }, { data: ds }, { data: vd }, { data: bt }, { data: cn },
             { data: ni }] = await Promise.all([
        hubStore('daemons_channels', { order: 'added_at:desc', limit: 100 }),
        hubStore('daemons_digest_sources', { kind: 'source', order: 'id:asc', limit: 200 }),
        hubStore('daemons_videos', {
          order: 'discovered_at:desc', limit: 50,
          ...(filterChannel ? { channel_id: filterChannel } : {}),
        }),
        hubStore('scheduler_channel_targets', { limit: 200 }),
        hubStore('platform_adapters_connections', { limit: 200 }),
        hubStore('daemons_news_items', { order: 'collected_at:desc', limit: 500 }),
      ])
      setChannels(ch.rows); setDigestSources(ds.rows); setVideos(vd.rows); setError('')
      reloadDomains()                                    // 频道域可能刚被改 → 刷新领域候选
      // 绑定存边对象数组;兼容旧行(connection_ids 裸 id)→ 补默认设置
      setBindings(Object.fromEntries((bt.rows || []).map(r => [
        r.data?.channel_id,
        r.data?.targets || (r.data?.connection_ids || []).map(id => ({ connection_id: String(id) }))])))
      setAccounts(connectionsToTargets(cn.rows))
      const preview = {}
      for (const it of (ni.rows || [])) {
        const k = newsKeyOfItem(it)
        if (k && !(k in preview)) preview[k] = it.title
      }
      setLatestNews(preview)
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    }
  }, [filterChannel, reloadDomains])
  useEffect(() => { load() }, [load])

  const maybe = (hit) => {
    if (!hit || timerRef.current) return
    timerRef.current = setTimeout(() => { timerRef.current = null; load() }, 500)
  }
  useHubEvent('store', (m) => maybe(String(m.table || '').startsWith('daemons_')
                                 || m.table === 'scheduler_channel_targets'))
  useHubEvent('msg', (m) => maybe(m.topic?.startsWith('daemons/monitor/')))

  const removeChannel = async (c) => {
    if (!(await confirm(`移除频道 ${c.channel_name || c.channel_id}?其发现记录将一并清理`))) return
    await hubCommand('web/monitor/channel_remove_requested', { channel_id: c.channel_id })
  }
  const removeDigestSource = async (s) => {
    if (!(await confirm(`移除采集源「${s.data.value}」?`))) return
    await hubCommand('web/monitor/digest_source_remove_requested', { source_id: s.id })
  }
  const fullCollect = async () => {
    await Promise.all([
      hubCommand('web/monitor/poll_requested', {}),
      hubCommand('web/digest/collect_requested', {}),
    ])
  }
  const collectChannel = (c) =>
    hubCommand('web/monitor/poll_channel_requested', { channel_id: c.channel_id })
  const collectDigestSource = (s) =>
    hubCommand('web/digest/collect_source_requested', { kind: s.data.kind, value: s.data.value })
  const targetsFor = (cid) => {
    const ids = new Set((bindings[cid] || []).map(t => String(t.connection_id)))
    return accounts.filter(a => ids.has(String(a.id)))
  }
  const chName = (cid) =>
    channels.find(c => c.channel_id === cid)?.channel_name || cid.slice(0, 12) + '…'
  const createJobFor = async (v) => {
    if (!(await confirm(`为该视频创建任务?\n${v.title || v.video_id}`))) return
    const ch = channels.find(c => c.channel_id === v.channel_id)
    await hubCommand('web/job/requested', {
      video_url: watchUrl(v.video_id),
      task_type: ch?.task_type || 'video_translate',
      pipeline_params: { publish_to_platform: true, channel_id: v.channel_id },
    })
    setTimeout(load, 1500)
  }

  const total = channels.length + digestSources.length
  const Badge = ({ children, color }) => (
    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8,
                   border: `1px solid ${color}`, color, whiteSpace: 'nowrap' }}>{children}</span>
  )

  const sourceGroups = [
    {
      type: 'video', rows: channels, key: (c) => `ch-${c.id}`,
      label: typeLabels.video_translate || '视频翻译',
      title: (c) => c.channel_name || '(未命名)', sub: (c) => c.channel_id,
      badge: (c) => c.auto_job ? { t: '自动', c: '#16a34a' } : { t: '手动', c: '#8b949e' },
      config: (c) => (
        <>
          <span className="text-muted">
            每 {Math.round(c.poll_interval / 60)} 分 ·{' '}
            {c.max_duration_minutes ? `≤${c.max_duration_minutes} 分` : '不限时长'}
          </span>
          {c.domain && (
            <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 8,
                           border: '1px solid #a78bfa', color: '#a78bfa',
                           whiteSpace: 'nowrap' }} title="所在名词域">
              {c.domain}
            </span>
          )}
        </>),
      targets: (c) => targetsFor(c.channel_id),
      lastAt: (c) => fmt(c.last_polled),
      highlight: (c) => filterChannel === c.channel_id,
      rowClick: (c) => setFilterChannel(filterChannel === c.channel_id ? '' : c.channel_id),
      onCollect: (c) => collectChannel(c),
      onEdit: (c) => setConfigFor({ source: c, type: 'video' }),
      onRemove: (c) => removeChannel(c),
    },
    {
      type: 'digest', rows: digestSources, key: (s) => `dg-${s.id}`,
      label: typeLabels.news_digest || '新闻日报',
      title: (s) => s.data.kind === 'hotlist'
        ? (HOTLIST_NAME[s.data.value] || s.data.value) : s.data.value,
      sub: (s) => s.data.name,
      badge: (s) => ({ t: KIND_LABEL[s.data.kind] || s.data.kind, c: '#8957e5' }),
      config: (s) => (
        <span className="text-muted"
              style={{ color: s.data.enabled ? undefined : 'var(--warning, #d29922)' }}>
          {s.data.enabled
            ? `每 ${Math.round((s.data.poll_interval || 3600) / 60)} 分`
            : '已停用'}
        </span>),
      preview: (s) => latestNews[newsKeyOfSource(s.data)],
      lastAt: (s) => fmt(s.data.last_collected_at),
      highlight: () => false,
      rowClick: null,
      onCollect: (s) => collectDigestSource(s),
      onEdit: (s) => setConfigFor({ source: s, type: 'digest' }),
      onRemove: (s) => removeDigestSource(s),
    },
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">频道监控</div>
          <div className="page-sub">监控源登记 · 频道 + 日报源 · 发现记录</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={fullCollect}><Icon name="zap" size={13} /> 全量采集</button>
      </div>
      <PublishActivity selectedChannel={filterChannel} />
      <AddSourceForm typeLabels={typeLabels} domains={domainOpts} langOptions={langOptions} onSubmitted={load} />
      {error && <div className="alert alert-error mb-16"><Icon name="alert" size={14} /> {error}</div>}

      <div className="mb-16">
        <div className="flex-between" style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>监控源({total})</span>
          <span className="text-muted" style={{ fontSize: 11 }}>
            频道 {channels.length} · 日报源 {digestSources.length}
          </span>
        </div>

        {total === 0 ? (
          <div className="panel" style={{ padding: 24, textAlign: 'center', color: 'var(--gray-400)' }}>
            暂无监控源,在上方登记一个
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {sourceGroups.flatMap((g) => g.rows.map((r) => {
              const b = g.badge(r)
              const hl = g.highlight(r)
              const ts = g.targets ? g.targets(r) : null
              const pv = g.preview ? g.preview(r) : undefined
              return (
                <div key={g.key(r)} className="panel"
                     onClick={g.rowClick ? () => g.rowClick(r) : undefined}
                     style={{ cursor: g.rowClick ? 'pointer' : 'default',
                              boxShadow: hl ? 'inset 3px 0 0 var(--accent)' : undefined,
                              background: hl ? 'var(--gray-100)' : undefined }}>
                  <div className="panel-head">
                    <span className="panel-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.title(r)}>
                      {g.title(r)}
                    </span>
                    <Badge color={b.c}>{b.t}</Badge>
                  </div>
                  <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    {g.sub(r) && (
                      <div className="text-muted text-mono" title={g.sub(r)}
                           style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {g.sub(r)}
                      </div>
                    )}
                    <div className="text-muted" style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span>{g.label}</span>
                      {g.config(r)}
                    </div>
                    {g.preview && (
                      <div title={pv || ''}
                           style={{ fontSize: 12, lineHeight: 1.4, color: pv ? undefined : 'var(--text-muted)',
                                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden', minHeight: '2.8em' }}>
                        {pv || '暂无采集条目'}
                      </div>
                    )}
                    {ts !== null && (ts.length > 0 ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {ts.map(t => (
                          <span key={t.id} title={t.label}
                                style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8,
                                         maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
                                         whiteSpace: 'nowrap',
                                         border: `1px solid ${PLAT_COLOR[t.platform] || '#8b949e'}`,
                                         color: PLAT_COLOR[t.platform] || '#8b949e' }}>
                            {(PLATFORM_LABEL[t.platform] || t.platform)} · {t.name}
                          </span>))}
                      </div>
                    ) : (
                      <div className="text-muted" style={{ fontSize: 11 }}>未绑定发布目标</div>
                    ))}
                  </div>
                  <div className="panel-foot" onClick={e => e.stopPropagation()}>
                    <span className="text-muted" style={{ fontSize: 11 }}>上次 {g.lastAt(r)}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                              title="立即采集此源" onClick={() => g.onCollect(r)}><Icon name="zap" size={12} /> 采集</button>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => g.onEdit(r)}><Icon name="edit" size={12} /> 编辑</button>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => g.onRemove(r)}><Icon name="x" size={12} /> 移除</button>
                    </div>
                  </div>
                </div>
              )
            }))}
          </div>
        )}
      </div>

      <div className="text-muted" style={{ fontSize: 11, margin: '0 2px 16px' }}>
        日报源由后台循环按各自间隔持续采集入池(原始条目);聚类去重与 SearXNG 富化属筛选,统一在日报任务执行时进行(闲时排产每日一期)。
      </div>

      <div>
        <div style={{ padding: '0 2px 10px', fontSize: 13, fontWeight: 700 }}>
          最近发现{filterChannel ? ` · ${chName(filterChannel)}` : ''}({videos.length})
        </div>
        {videos.length === 0 ? (
          <div className="panel" style={{ padding: 24, textAlign: 'center', color: 'var(--gray-400)' }}>
            暂无发现记录
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {videos.map((v) => (
              <div key={v.id} className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <a href={watchUrl(v.video_id)} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                  <Thumb width="100%" aspectRatio="16 / 9"
                         src={`https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg`}
                         placeholder={<Icon name="video" size={22} />} />
                </a>
                <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <a href={watchUrl(v.video_id)} target="_blank" rel="noreferrer" title={v.title}
                     style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35,
                              display: '-webkit-box', WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {v.title || v.video_id}
                  </a>
                  <div className="text-muted" style={{ fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <span>{chName(v.channel_id)}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{durText(v.duration)}</span>
                  </div>
                  <div className="text-muted" style={{ fontSize: 10, lineHeight: 1.6 }}>
                    <div>发布 {fmt(v.published_at)}</div>
                    <div>发现 {fmt(v.discovered_at)}</div>
                  </div>
                </div>
                <div className="panel-foot">
                  {v.job_id
                    ? <button key="jump" className="btn btn-outline btn-sm" title={`跳转到任务 ${v.job_id}`}
                              onClick={() => navigate(`/jobs?highlight=${v.job_id}`)}
                              style={{ fontFamily: 'monospace', fontSize: 11, padding: '2px 8px' }}>
                        {v.job_id.slice(0, 8)} <Icon name="arrowUpRight" size={11} />
                      </button>
                    : <button key="create" className="btn btn-outline btn-sm" title="为该视频手动创建任务"
                              onClick={() => createJobFor(v)}
                              style={{ fontSize: 11, padding: '2px 8px' }}>
                        <Icon name="plus" size={12} /> 创建
                      </button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {configFor && (
        <ConfigModal source={configFor.source} type={configFor.type} accounts={accounts}
            domains={domainOpts} langOptions={langOptions}
            bound={configFor.type === 'video'
              ? (bindings[configFor.source.channel_id] || []) : []}
            onClose={() => setConfigFor(null)}
            onSaved={() => { setConfigFor(null); load() }} />
      )}
    </div>
  )
}
