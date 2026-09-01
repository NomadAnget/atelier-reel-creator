// 发布目标选择器(逐账号勾选 + per-edge 可见性/内容声明)。频道绑定(Monitor 配置弹窗)与
// 新建任务(CreateJobModal)复用同一组件——手选账号即配好该 (目标×账号) 边的发布设置。
//   value = [{ connection_id, visibility, declaration }];accounts = [{ id, label }]。
// 值/枚举对齐后端 scheduler_channel_targets.targets 与发布引擎各平台 VIS_TXT/DECL_TXT 归一键。

// 可见性默认「仅自己可见」(最安全,杜绝误发公开),声明默认「AI 生成」(合规)。
export const VIS_OPTS = [['private', '仅自己可见'], ['friends', '好友可见'], ['public', '公开']]
export const DECL_OPTS = [['ai_generated', 'AI 生成'], ['', '无声明'], ['fiction', '虚构演绎'],
  ['opinion', '个人观点'], ['repost', '转载'], ['marketing', '营销推广']]
export const DEFAULT_TARGET = { visibility: 'private', declaration: 'ai_generated' }

export default function TargetPicker({ accounts = [], value = [], onChange, empty }) {
  const byId = Object.fromEntries((value || []).map(t => [String(t.connection_id), t]))
  const toggle = (id) => {                       // 勾选=加默认设置的边;取消=移除
    const k = String(id)
    if (k in byId) onChange((value || []).filter(t => String(t.connection_id) !== k))
    else onChange([...(value || []), { connection_id: k, ...DEFAULT_TARGET }])
  }
  const setS = (id, key, val) => onChange((value || []).map(t =>
    String(t.connection_id) === String(id) ? { ...t, [key]: val } : t))

  if (!accounts.length) {
    return <div className="text-muted" style={{ fontSize: 12 }}>
      {empty || '暂无已连接账号(先在「发布账号」页添加)'}</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {accounts.map(a => {
        const on = String(a.id) in byId
        const cur = byId[String(a.id)] || DEFAULT_TARGET
        return (
          <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 8,
            padding: '8px 10px', background: on ? 'var(--bg-card)' : 'transparent' }}>
            <label style={{ fontSize: 13, display: 'flex', gap: 8,
                            alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={on} onChange={() => toggle(a.id)} />
              {a.label}
            </label>
            {on && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8,
                            paddingLeft: 24, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', flex: '1 1 130px' }}>
                  可见性
                  <select className="input" style={{ width: '100%', marginTop: 2 }}
                          value={cur.visibility}
                          onChange={e => setS(a.id, 'visibility', e.target.value)}>
                    {VIS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', flex: '1 1 130px' }}>
                  内容声明
                  <select className="input" style={{ width: '100%', marginTop: 2 }}
                          value={cur.declaration}
                          onChange={e => setS(a.id, 'declaration', e.target.value)}>
                    {DECL_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
