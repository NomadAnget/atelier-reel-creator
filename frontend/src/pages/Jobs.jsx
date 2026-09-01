// 任务管理(新系统):scheduler_jobs 类型化表 + 通用端点;SSE 状态事件驱动刷新。
// 布局=横向任务卡(一行一卡,类型异构:翻译卡=源缩略图+元数据标题,
// 日报卡=期号日期+产出封面),状态/发布徽章与操作槽跨卡对齐。
// 零专用 API——列表/过滤/翻页全走 /api/store/scheduler_jobs;
// 重启失败任务 = 重发 web/job/requested(命令去重语义:同 video_url 的
// failed/cancelled/idle 任务重启同一行,不另起新行)。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { hubCommand, hubStore, hubSnapshot } from '../api/hub'
import { useHubEvent } from '../hooks/HubStream'
import LiveElapsed from '../components/LiveElapsed'
import CreateJobModal from '../components/CreateJobModal'
import { confirm } from '../components/confirm'
import { P_LABEL } from './PublishAccounts'
import Thumb from '../components/Thumb'
import ResultModal from '../components/ResultModal'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import useIsMobile from '../hooks/useIsMobile'

const RESTARTABLE = new Set(['failed', 'cancelled', 'idle'])
const CANCELLABLE = new Set(['queued', 'running'])
const DELETABLE = new Set(['idle', 'queued', 'succeeded', 'failed', 'cancelled'])  // running 须先取消

const STATUS_STYLE = {
  idle:      { color: '#64748b', label: '空闲待启' },
  queued:    { color: '#38bdf8', label: '排队中' },
  running:   { color: '#f59e0b', label: '执行中' },
  succeeded: { color: '#34d399', label: '已完成' },
  failed:    { color: '#f87171', label: '失败' },
  cancelled: { color: '#8b99b4', label: '已取消' },
}
const STATUSES = Object.keys(STATUS_STYLE)
// 发布态徽章(仅带发布意图的任务显示;持久事实在 jobs 行 publish_* 列)
const PUB_STYLE = {
  pending:   { color: '#f59e0b', label: '待发布' },
  published: { color: '#34d399', label: '已发布' },
  failed:    { color: '#f87171', label: '发布失败' },
  discarded: { color: '#8b99b4', label: '已丢弃' },
}
const parseJson = (s) => { try { return JSON.parse(s || '{}') || {} } catch { return {} } }
// YouTube 视频 id(元数据缩略图/标题匹配用)
const ytId = (url) => (String(url).match(/[?&]v=([\w-]{6,})/) || [])[1]
  || (String(url).match(/youtu\.be\/([\w-]{6,})/) || [])[1] || ''

const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '—'
const fmtDur = (s) => {
  s = Math.max(0, Math.round(s))
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}
const dur = (row) => {   // 终态行:一次性算好,不跑表(ended_at 已定格,无需计时)
  if (!row.started_at) return '—'
  return fmtDur((row.ended_at || Date.now() / 1000) - row.started_at)
}

export default function Jobs() {
  const isMobile = useIsMobile()
  const [rows, setRows] = useState([])
  const [videoMeta, setVideoMeta] = useState({})   // video_id → {title, channel_id, duration}
  const [chNames, setChNames] = useState({})       // channel_id → 频道名
  const [resultJob, setResultJob] = useState('')   // 结果弹窗:目标 job_id(空=关闭)
  // 监控页跳转定位:?highlight=<job_id> → 滚动到该行 + 短暂高亮(非持久,3s 后自动褪去)
  const [searchParams, setSearchParams] = useSearchParams()
  const [highlight, setHighlight] = useState(() => searchParams.get('highlight') || '')
  const highlightRef = useRef(null)
  const scrolledRef = useRef(false)
  useEffect(() => {
    if (highlight && !scrolledRef.current && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
      scrolledRef.current = true
    }
  })
  useEffect(() => {
    if (!highlight) return
    setSearchParams((sp) => { sp.delete('highlight'); return sp }, { replace: true })
    const t = setTimeout(() => setHighlight(''), 3000)
    return () => clearTimeout(t)
  }, [highlight])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)       // 首屏骨架
  const [restarting, setRestarting] = useState({})   // job_id → 提交中(防重复点击)
  const [showCreate, setShowCreate] = useState(false)
  const [taskTypes, setTaskTypes] = useState({})     // 可创建的任务类型 + 表单规格
  const timerRef = useRef(null)

  const cancel = async (r) => {
    if (r.status === 'running' &&
        !(await confirm('任务执行中:取消是协作式的,在下一个检查点生效。确认?'))) return
    if (restarting[r.job_id]) return
    setRestarting(p => ({ ...p, [r.job_id]: true }))
    try {
      await hubCommand('web/job/cancel_requested', { job_id: r.job_id })
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setTimeout(() => setRestarting(p => {
        const n = { ...p }; delete n[r.job_id]; return n
      }), 1500)
    }
  }

  const del = async (r) => {
    if (!(await confirm(`删除任务?此操作从列表移除该行,不可撤销。\n${r.video_url}`))) return
    if (restarting[r.job_id]) return
    setRestarting(p => ({ ...p, [r.job_id]: true }))
    try {
      await hubCommand('web/job/delete_requested', { job_id: r.job_id })
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setTimeout(() => setRestarting(p => {
        const n = { ...p }; delete n[r.job_id]; return n
      }), 1500)
    }
  }

  const restart = async (r) => {
    if (restarting[r.job_id]) return
    setRestarting(p => ({ ...p, [r.job_id]: true }))
    try {
      await hubCommand('web/job/requested', {
        video_url: r.video_url, task_type: r.task_type,
        target_lang: r.target_lang || 'zh',
      }, r.job_id, '重启任务')
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setTimeout(() => setRestarting(p => {
        const n = { ...p }; delete n[r.job_id]; return n
      }), 1500)
    }
  }

  // 手动发布:成片已在盘,仅重走发布出闸(逐目标幂等,已发布平台跳过)
  const republish = async (r) => {
    if (restarting[r.job_id]) return
    if (!(await confirm(`发布任务 ${r.job_id.slice(0, 8)} 的成片?\n`
                        + '按任务配置的目标出闸;已发布平台幂等跳过,不重跑管线。'))) return
    setRestarting(p => ({ ...p, [r.job_id]: true }))
    try {
      await hubCommand('web/job/republish_requested', { job_id: r.job_id })
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setTimeout(() => setRestarting(p => {
        const n = { ...p }; delete n[r.job_id]; return n
      }), 1500)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { order: 'id:desc', limit: 100 }
      if (status) params.status = status
      const { data } = await hubStore('scheduler_jobs', params)
      setRows(data.rows)
      try {
        const [vids, chs] = await Promise.all([
          hubStore('daemons_videos', { order: 'id:desc', limit: 500 }),
          hubStore('daemons_channels', { limit: 200 }),
        ])
        setVideoMeta(Object.fromEntries(vids.data.rows.map(
          (v) => [v.video_id, { title: v.title, channel_id: v.channel_id,
                                duration: v.duration }])))
        setChNames(Object.fromEntries(chs.data.rows.map(
          (c) => [c.channel_id, c.channel_name || ''])))
      } catch { /* 元数据映射失败不影响任务列表本体 */ }
      setError('')
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }, [status])
  useEffect(() => { load() }, [load])

  useHubEvent('msg', (m) => {                        // 状态事件 → 去抖刷新(零轮询)
    if (!m.topic?.startsWith('scheduler/job/')) return
    if (timerRef.current) return
    timerRef.current = setTimeout(() => { timerRef.current = null; load() }, 400)
  })

  useHubEvent('store', (s) => {                      // 删除是 store 操作(不发 topic 消息)→ 刷新
    if (s.table !== 'scheduler_jobs' || s.op !== 'delete') return
    if (timerRef.current) return
    timerRef.current = setTimeout(() => { timerRef.current = null; load() }, 400)
  })

  // 可创建的任务类型 + 表单规格(后端注册表声明,前端纯渲染)
  useEffect(() => {
    hubSnapshot().then(({ data }) => setTaskTypes(data.task_types || {})).catch(() => {})
  }, [])

  // 目标语言 码→名(同源自管线 create_spec,单一真相源;老任务无 target_lang 视为 zh)
  const langLabels = Object.fromEntries(
    ((taskTypes.video_translate?.fields || []).find(f => f.name === 'target_lang')?.options || [])
      .map(o => [o.value, o.label]))

  return (
    <div>
      {showCreate && (
        <CreateJobModal taskTypes={taskTypes}
                        onClose={() => setShowCreate(false)}
                        onCreated={() => setTimeout(load, 300)} />
      )}
      {resultJob && (
        <ResultModal jobId={resultJob} onClose={() => setResultJob('')} />
      )}

      <div className="page-head">
        <div>
          <div className="page-title">任务管理</div>
          <div className="page-sub">创建 · 执行 · 发布 · 结果,SSE 实时刷新</div>
        </div>
        <div className="toolbar">
          <button className="btn btn-primary btn-sm" disabled={Object.keys(taskTypes).length === 0}
                  onClick={() => setShowCreate(true)}><Icon name="plus" size={14} /> 新建任务</button>
          <button className="btn btn-outline btn-sm" onClick={load}><Icon name="refresh" size={14} /> 刷新</button>
        </div>
      </div>

      <div className="mb-16" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="text-muted" style={{ fontSize: 11, fontWeight: 700 }}>状态</span>
        {STATUSES.map((st) => (
          <span key={st} onClick={() => setStatus(status === st ? '' : st)}
                className={`chip${status === st ? ' on' : ''}`}
                style={{ '--chip': STATUS_STYLE[st].color }}>
            {STATUS_STYLE[st].label}
          </span>
        ))}
      </div>

      {error && <div className="alert alert-error mb-16"><Icon name="alert" size={14} /> {error}</div>}

      {loading && rows.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="card" style={{ padding: '14px', display: 'flex', gap: 14, alignItems: 'center' }}>
              <Skeleton width={128} height={72} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Skeleton width="70%" height={16} />
                <Skeleton width="45%" height={12} />
                <Skeleton width="55%" height={12} />
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && rows.length === 0 && (
        <div className="panel" style={{ padding: 32, textAlign: 'center', color: 'var(--gray-400)' }}>
          暂无任务
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => {
          const st = STATUS_STYLE[r.status] || { color: '#8b99b4', label: r.status }
          const hl = highlight && r.job_id === highlight
          const isDigest = r.task_type === 'news_digest'
          const vid = isDigest ? '' : ytId(r.video_url)
          const thumb = isDigest
            ? (r.status === 'succeeded' ? `/api/jobs/${r.job_id}/cover` : '')
            : (vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : '')
          const digestDate = isDigest ? String(r.video_url).replace('digest://', '') : ''
          const vm = videoMeta[vid]
          const title = isDigest ? `新闻日报 · ${digestDate}` : (vm?.title || r.video_url)
          const pubIntent = parseJson(r.pipeline_params).publish_to_platform
          const pb = pubIntent ? (PUB_STYLE[r.publish_status] || PUB_STYLE.pending) : null
          const tEntries = Object.entries(parseJson(r.publish_payload).targets || {})
          const canPublish = r.status === 'succeeded' && pubIntent
            && r.publish_status !== 'published'
          const primary = canPublish
            ? { icon: 'send', label: '发布', color: '#16a34a', act: republish,
                tip: '手动发布:成片直发配置目标,不重跑管线' }
            : RESTARTABLE.has(r.status)
              ? { icon: 'refresh', label: '重启', color: undefined, act: restart, tip: undefined }
              : CANCELLABLE.has(r.status)
                ? { icon: 'x', label: '取消', color: '#dc2626', act: cancel,
                    tip: r.status === 'running' ? '协作式取消:下一检查点生效' : undefined }
                : null
          return (
            <div key={r.id} ref={hl ? highlightRef : null} className="card"
                 style={{ padding: '12px 14px', display: 'flex', gap: isMobile ? 10 : 14,
                           flexDirection: isMobile ? 'column' : 'row',
                           alignItems: isMobile ? 'stretch' : 'center',
                           transition: 'background .6s, box-shadow .6s',
                           background: hl ? 'rgba(88,166,255,.14)' : undefined,
                           boxShadow: hl ? 'inset 3px 0 0 var(--accent)' : undefined }}>
              <div style={{ display: 'flex', gap: isMobile ? 10 : 14, flex: 1, minWidth: 0,
                            flexDirection: isMobile ? 'column' : 'row',
                            alignItems: 'stretch' }}>
              <Thumb src={thumb}
                     width={isMobile ? '100%' : 128}
                     aspectRatio={isMobile ? '16 / 9' : undefined}
                     placeholder={isDigest
                       ? <span style={{ display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', lineHeight: 1.2, gap: 2 }}>
                           <Icon name="newspaper" size={20} />
                           <span style={{ fontSize: 10 }} className="text-muted">{digestDate.slice(5)}</span>
                         </span>
                       : <Icon name="video" size={22} />} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 100%', minWidth: 0,
                                overflow: 'hidden', textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap', fontWeight: 600, fontSize: 14 }}
                       title={title}>{title}</div>
                  <span className="status-dot" style={{ color: st.color, whiteSpace: 'nowrap',
                                                         cursor: r.status === 'failed' && r.error_msg ? 'help' : undefined }}
                        title={r.status === 'failed' ? (r.error_msg || undefined) : undefined}>
                    {st.label}
                  </span>
                  {tEntries.length > 0 ? tEntries.map(([p, t]) => {
                    const c = (PUB_STYLE[t.status] || PUB_STYLE.pending).color
                    const mark = t.status === 'published' ? ' ✓'
                      : t.status === 'failed' ? ' ✗'
                        : t.status === 'discarded' ? ' —' : ' …'
                    const acctLabel = t.account_name || t.account || ''
                    return (
                      <span key={p}
                            title={`${acctLabel} · ${(PUB_STYLE[t.status] || PUB_STYLE.pending).label}`
                                   + (t.detail ? `\n${t.detail}` : '')}
                            style={{ color: c, border: `1px solid ${c}`, borderRadius: 8,
                                     padding: '0 6px', fontSize: 11,
                                     whiteSpace: 'nowrap', flexShrink: 0,
                                     cursor: t.detail ? 'help' : undefined }}>
                        {P_LABEL[p] || p}{acctLabel && ` · ${acctLabel}`}{mark}
                      </span>
                    )
                  }) : pb && (
                    <span style={{ color: pb.color, border: `1px solid ${pb.color}`,
                                   borderRadius: 8, padding: '0 6px', fontSize: 11,
                                   whiteSpace: 'nowrap', flexShrink: 0 }}
                          title={r.publish_error || undefined}>{pb.label}</span>
                  )}
                </div>
                <div className="text-muted"
                     style={{ fontSize: 11, marginTop: 3, display: 'flex', gap: 10,
                               flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span>{(taskTypes[r.task_type] || {}).label || r.task_type}</span>
                  {!isDigest && (
                    <span>{langLabels[r.target_lang || 'zh'] || r.target_lang || 'zh'}</span>
                  )}
                  <span style={{ fontFamily: 'monospace', fontSize: 10 }}
                        title={r.job_id}>{(r.job_id || '').slice(0, 8)}</span>
                  {vm?.channel_id && <span>{chNames[vm.channel_id] || vm.channel_id}</span>}
                  {vm?.duration > 0 && <span>片长 {fmtDur(vm.duration)}</span>}
                  {!isDigest && (
                    <a href={r.video_url} target="_blank" rel="noreferrer"
                       style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      源视频 <Icon name="arrowUpRight" size={11} />
                    </a>
                  )}
                  <span>创建 {fmt(r.created_at)}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    耗时 {r.status === 'running'
                      ? <LiveElapsed anchor={r.started_at} render={fmtDur} />
                      : dur(r)}
                  </span>
                </div>
                {r.status === 'running' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                                marginTop: 6, maxWidth: 480 }}>
                    <span className="mini-progress running" style={{ flex: 1 }}>
                      <i style={{ width: `${Math.min(100, r.progress || 0)}%`, background: st.color }} />
                    </span>
                    <span className="text-muted"
                          style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(r.progress || 0)}%
                    </span>
                    {r.progress_message && (
                      <span className="text-muted" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                        {r.progress_message} · 本阶段{' '}
                        <LiveElapsed anchor={r.updated_at} render={fmtDur} />
                      </span>
                    )}
                  </div>
                )}
              </div>
              </div>
              {/* 操作区:可见按钮按 结果 → 发布/重启/取消 → 删除 顺序紧邻排布,不适用即不占位 */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center',
                            justifyContent: isMobile ? 'flex-end' : undefined }}>
                {r.status === 'succeeded' && (
                  <button className="btn btn-outline btn-sm"
                          title="查看任务产出的标题/简介/标签/章节/封面"
                          onClick={() => setResultJob(r.job_id)}>
                    <Icon name="eye" size={13} /> 结果
                  </button>
                )}
                {primary && (
                  <button className="btn btn-outline btn-sm"
                          style={{ color: primary.color }}
                          disabled={!!restarting[r.job_id]}
                          title={primary.tip}
                          onClick={() => primary.act(r)}>
                    <Icon name={primary.icon} size={13} /> {primary.label}
                  </button>
                )}
                {DELETABLE.has(r.status) && (
                  <button className="btn btn-outline btn-sm"
                          style={{ color: '#dc2626' }}
                          disabled={!!restarting[r.job_id]}
                          onClick={() => del(r)}>
                    <Icon name="trash" size={13} /> 删除
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
