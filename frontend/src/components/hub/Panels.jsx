// 观测台右栏组件:计数卡 / 存储与账本面板 / 无订阅 topic / 实时流水。
// 均为纯展示,数据来自 useHubStream。
import { confirm } from '../confirm'
import Icon from '../Icon'

const corrColor = (c) => `hsl(${parseInt((c || '0').slice(0, 6), 16) % 360} 65% 55%)`
const fmtTime = (ts) => new Date(ts * 1000).toTimeString().slice(0, 8)

// 量纲有别:已发布/已投递/重试来自 stats(**本次启动以来的增量**,重启归零);
// 死信取 journal.dead(**账本里的积压状态**,跨重启存在)。曾错用 stats.dead_letters
// ——账本积压 2 条时卡片却显示 0(那 2 条产生于上次启动,本次"新增"确为 0)。
export function StatCards({ stats, rate, journal }) {
  const dead = journal?.dead ?? 0
  const items = [
    { label: '发布', value: stats?.published != null
        ? stats.published - (stats.published_ephemeral ?? 0) : '—',
      hint: '持久消息' },
    { label: '遥测', value: stats?.published_ephemeral ?? '—', hint: '旁路直达,无投递账' },
    { label: '投递', value: stats?.delivered ?? '—', hint: '订阅者签收' },
    { label: '重试', value: stats?.retried ?? '—', warn: (stats?.retried ?? 0) > 0,
      hint: '本次启动以来' },
    { label: '死信', value: journal ? dead : '—', error: dead > 0,
      hint: '账本积压(可重放/销账)' },
    { label: '吞吐', value: rate > 0 ? `${rate.toLocaleString()}/s` : '静默', hint: '实时' },
  ]
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {items.map(({ label, value, warn, error, hint }) => (
        <div key={label} className="card" title={hint}
             style={{ flex: '1 1 90px', padding: '10px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                        color: error ? 'var(--error, #f85149)' : warn ? 'var(--warning, #d29922)' : undefined }}>
            {value}
          </div>
          <div className="text-muted" style={{ fontSize: 11 }}>{label}</div>
        </div>
      ))}
    </div>
  )
}

export function StorePanel({ store, journal }) {
  const rows = Object.entries(store || {})
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>存储枢纽</div>
      {rows.map(([table, info]) => (
        <div key={table} className="flex-between" style={{ fontSize: 12, padding: '3px 0', gap: 8, flexWrap: 'nowrap' }}>
          <span title={`${table} @${info.owner} · ${info.type}`}
                style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {table}
            <span className="text-muted" style={{ fontSize: 10 }}> @{info.owner} · {info.type}</span>
          </span>
          <b style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{info.rows} 行</b>
        </div>
      ))}
      {journal && (
        <div className="flex-between" style={{ fontSize: 12, padding: '3px 0', borderTop: '1px solid var(--border, #30363d)', marginTop: 6, paddingTop: 8 }}>
          <span>投递账本 <span className="text-muted" style={{ fontSize: 10 }}>@内核</span></span>
          <b>待投 {journal.pending} · 死信 {journal.dead}</b>
        </div>
      )}
    </div>
  )
}

export function DeadTopics({ snap }) {
  // 能出现在这里的只可能是 EPHEMERAL 遥测(持久 topic 无订阅者会在组装期被拒):
  // 心跳/进度/告警通知等,哨兵与前端经观察者钩子旁路可见——"故意单身",不是事故。
  // 样式与 StorePanel 同规:名称+归属小注 | 右侧 tabular 计数,底部内核说明行。
  if (!snap) return null
  const consumed = new Set(snap.edges.map((e) => e.topic))
  const dead = Object.entries(snap.topics).filter(([t]) => !consumed.has(t))
  const label = (t) => {
    if (t.includes('/health/heartbeat')) return '心跳公约'
    if (t.includes('/progress')) return '进度遥测'
    if (t.includes('/alert/')) return '告警通知'
    if (t.includes('/publish_state')) return '状态通知'
    if (t.includes('/stage/')) return '阶段观测'
    return '遥测'
  }
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>遥测 topic</div>
      {dead.length === 0 && (
        <div className="text-muted" style={{ fontSize: 12 }}>(无)</div>
      )}
      {dead.map(([t, info]) => (
        <div key={t} className="flex-between" style={{ fontSize: 12, padding: '3px 0', gap: 8, flexWrap: 'nowrap' }}>
          <span title={`${t.split('/').slice(1).join('/')} @${t.split('/')[0]} · ${label(t)}`}
                style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.split('/').slice(1).join('/')}
            <span className="text-muted" style={{ fontSize: 10 }}> @{t.split('/')[0]} · {label(t)}</span>
          </span>
          <b style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{info.count} 条</b>
        </div>
      ))}
      <div className="flex-between" style={{ fontSize: 12, padding: '3px 0',
           borderTop: '1px solid var(--border, #30363d)', marginTop: 6, paddingTop: 8 }}>
        <span>零订阅设计态 <span className="text-muted" style={{ fontSize: 10 }}>@观察者钩子</span></span>
        <b className="text-muted" style={{ fontSize: 10, fontWeight: 400 }}>持久悬空在组装期即被拒</b>
      </div>
    </div>
  )
}

export function LiveFeed({ feed }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>实时流水(SSE)</div>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {feed.length === 0 && <div className="text-muted" style={{ fontSize: 12 }}>等待消息…</div>}
        {feed.map((m, i) => (
          <div key={`${m.msg_id || m.row_id || i}-${i}`}
               style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12,
                        padding: '4px 2px', borderBottom: '1px solid var(--border, #30363d)' }}>
            <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {fmtTime(m.ts)}
            </span>
            {m.kind === 'store' ? (
              <span style={{ wordBreak: 'break-all', display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <b style={{ color: '#a78bfa' }}>{m.domain}</b>
                <Icon name="database" size={12} />
                <span>{m.op} {m.table}#{m.row_id}</span>
              </span>
            ) : (
              <>
                <span style={{ wordBreak: 'break-all' }} title={JSON.stringify(m.payload)}>
                  <b style={{ color: 'var(--accent, #58a6ff)' }}>{m.source}</b> → {m.topic}
                </span>
                {m.corr && (
                  <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 10, padding: '0 6px',
                                 borderRadius: 8, border: `1px solid ${corrColor(m.corr)}`,
                                 color: corrColor(m.corr) }}>
                    {m.corr.slice(0, 6)}
                  </span>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// 死信面板:账本里重试超限的投递——可重放(修好后再试)或销账(确认作废)。
// 操作走内核运维端点(与 /api/snapshot 同类,总线自身的管理面)。
export function DeadLetters({ snap, onChanged }) {
  const dead = snap?.dead_letters || []
  if (dead.length === 0) return null
  const act = async (id, action) => {
    try {
      await fetch(`/api/journal/${id}/${action}`, { method: 'POST' })
    } finally {
      onChanged?.()
    }
  }
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 12, marginBottom: 8, color: '#f85149', fontWeight: 700,
                    display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="alert" size={15} /> 死信({dead.length})
      </div>
      {dead.map(d => (
        <div key={d.delivery_id} style={{ fontSize: 11, padding: '6px 2px',
             borderBottom: '1px solid var(--border, #30363d)' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ wordBreak: 'break-all', flex: 1 }}>
              <b>{d.topic}</b> → {d.subscriber}
              <span className="text-muted">(重试 {d.attempts} 次)</span>
            </span>
            <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: '1px 6px' }}
                    title="重置后立即重投(先确认处理器已修好)"
                    onClick={() => act(d.delivery_id, 'replay')}><Icon name="refresh" size={12} /> 重放</button>
            <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: '1px 6px',
                    color: '#dc2626' }}
                    title="确认作废,销账回收"
                    onClick={async () => { if (await confirm('销账此死信?(确认已无需处理)')) act(d.delivery_id, 'discard') }}>
              <Icon name="x" size={12} /> 销账</button>
          </div>
          <div className="text-muted" style={{ fontSize: 10, overflow: 'hidden',
               textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.last_error}>
            {d.last_error}
          </div>
        </div>
      ))}
    </div>
  )
}


// 哨兵事件面板:规则命中即立案(同一 rule+subject 去重成一行,hits 累加)。
// 未决在前、已解除在后。**detail 必须显示**——只给规则名等于没说"发生了什么"。
export function Incidents({ rows }) {
  const list = rows || []
  if (list.length === 0) return null
  const open = list.filter(r => r.data?.status !== 'cleared')
  const cleared = list.filter(r => r.data?.status === 'cleared')
  const color = s => (s === 'critical' ? '#f85149' : s === 'warning' ? '#d29922' : '#8b949e')
  const row = (r, isOpen) => (
    <div key={r.id} style={{ fontSize: 11, padding: '6px 2px', opacity: isOpen ? 1 : 0.55,
         borderBottom: '1px solid var(--border, #30363d)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: color(r.data?.severity), fontWeight: 700 }}>
          [{r.data?.severity}] {r.data?.rule}
        </span>
        <span className="text-muted">{r.data?.subject}</span>
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 10 }}>
          {isOpen ? '未决' : '已解除'} · 命中 {r.data?.hits ?? 0} 次
        </span>
      </div>
      <div style={{ fontSize: 11, marginTop: 2 }}>{r.data?.detail}</div>
      <div className="text-muted" style={{ fontSize: 10, marginTop: 1 }}>
        起于 {String(r.created_at || '').replace('T', ' ').slice(0, 19)}
        {r.updated_at && r.updated_at !== r.created_at &&
          ` · 最近 ${String(r.updated_at).replace('T', ' ').slice(0, 19)}`}
      </div>
    </div>
  )
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 700,
           color: open.length ? '#f85149' : undefined, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="alert" size={15} /> 哨兵事件(未决 {open.length} / 共 {list.length})
      </div>
      {open.map(r => row(r, true))}
      {cleared.map(r => row(r, false))}
    </div>
  )
}
