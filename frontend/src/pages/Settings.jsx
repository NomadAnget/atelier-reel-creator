// 系统设置(新系统):运行时配置=域数据的前端统筹面。
// 纯按后端声明渲染——每个设置项的中文名/控件形式/枚举选项/是否密钥/是否隐藏,全在后端
// Record 用 Setting() 就地声明,经 /api/snapshot 的 store 元数据(settings_fields/settings_label)
// 下发;本页零元数据、零硬编码。写回走 web/settings/edit_requested(domain+补丁)。
// 加/改设置项只动后端 Record 一处,本页自动跟随;新域加设置表本页也零改动自动出现。
import { useCallback, useEffect, useRef, useState } from 'react'
import { hubSnapshot, hubStore, hubCommand } from '../api/hub'
import { useHubEvent } from '../hooks/HubStream'
import Icon from '../components/Icon'

const isStrArray = (v) => Array.isArray(v) && v.every(x => typeof x === 'string')

// 解析控件:secret → 密码框;widget=auto → 按值类型(或声明 type)推;否则用声明 widget。
function resolveWidget(spec, value) {
  if (spec?.secret) return 'password'
  const w = spec?.widget || 'auto'
  if (w !== 'auto') return w
  const t = spec?.type
  if (typeof value === 'boolean' || t === 'boolean') return 'toggle'
  if (typeof value === 'number' || t === 'integer' || t === 'number') return 'number'
  if (isStrArray(value) || t === 'array') return 'textarea'
  if (typeof value === 'string' || t === 'string') return 'text'
  return 'json'
}

// 敏感值输入:默认遮罩(左侧锁图标 + 圆点),眼睛按钮切换明文
function SecretInput({ value, onChange }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <div style={{ position: 'relative', flex: 1 }}>
        <Icon name="lock" size={13} style={{ position: 'absolute', left: 10, top: '50%',
                                             transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
        <input className="input" type={show ? 'text' : 'password'} style={{ paddingLeft: 30 }}
               value={value} autoComplete="off" spellCheck={false}
               onChange={e => onChange(e.target.value)} />
      </div>
      <button className="btn btn-outline btn-sm" type="button" style={{ flexShrink: 0 }}
              title={show ? '隐藏' : '显示'} onClick={() => setShow(v => !v)}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={14} />
      </button>
    </div>
  )
}

function Field({ name, spec, value, draft, voices, onChange }) {
  const cur = draft !== undefined ? draft : value
  const dirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(value)
  const label = spec?.label || name
  const help = spec?.help
  const widget = resolveWidget(spec, value)

  const labelEl = (
    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
      {label}
      <span className="text-muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: 10 }}>{name}</span>
      {dirty && <span style={{ color: '#f59e0b', marginLeft: 6 }}>●</span>}
    </div>
  )
  const hintEl = help ? <div className="form-hint">{help}</div> : null

  // toggle:标签与勾选同行(布局与其它不同,单独返回)
  if (widget === 'toggle') {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={!!cur} onChange={e => onChange(name, e.target.checked)} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{label}
            <span className="text-muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: 10 }}>{name}</span>
            {dirty && <span style={{ color: '#f59e0b', marginLeft: 6 }}>●</span>}
          </span>
        </div>
        {hintEl}
      </div>
    )
  }

  let control
  if (widget === 'select') {
    control = (
      <select className="input" style={{ width: '100%' }} value={String(cur ?? '')}
              onChange={e => onChange(name, e.target.value)}>
        {(spec?.options || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    )
  } else if (widget === 'password') {
    control = <SecretInput value={String(cur ?? '')} onChange={v => onChange(name, v)} />
  } else if (widget === 'voiceprint') {
    control = (
      <select className="input" style={{ width: '100%' }} value={cur ?? ''}
              onChange={e => onChange(name, e.target.value)}>
        <option value="">(默认:库中第一份)</option>
        {voices.map(v => (
          <option key={v.asset_id} value={v.asset_id}>
            {v.label || v.asset_id}{v.duration_sec ? ` · ${Math.round(v.duration_sec)}s` : ''}
          </option>
        ))}
      </select>
    )
  } else if (widget === 'number') {
    control = (
      <input className="input" type="number" step="any" style={{ width: 180 }} value={cur ?? 0}
             onChange={e => onChange(name, e.target.value === '' ? 0 : Number(e.target.value))} />
    )
  } else if (widget === 'textarea') {
    const arr = Array.isArray(cur) ? cur : []
    control = (
      <>
        <textarea className="input" rows={Math.min(8, Math.max(2, arr.length + 1))}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                  value={arr.join('\n')}
                  onChange={e => onChange(name, e.target.value.split('\n').map(s => s.trim()).filter(Boolean))} />
        <div className="form-hint">每行一条,留空则清空</div>
      </>
    )
  } else if (widget === 'text') {
    control = (
      <input className="input" style={{ width: '100%' }} value={cur ?? ''}
             onChange={e => onChange(name, e.target.value)} />
    )
  } else {  // json 兜底
    control = (
      <textarea className="input" rows={3} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                value={JSON.stringify(cur)}
                onChange={e => { try { onChange(name, JSON.parse(e.target.value)) } catch { /* 输入中 */ } }} />
    )
  }
  return (
    <div style={{ marginBottom: 14 }}>
      {labelEl}
      {control}
      {widget !== 'textarea' && hintEl}
    </div>
  )
}

function Section({ domain, table, label, values, fields, voices, onSaved }) {
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const patch = Object.fromEntries(Object.entries(drafts).filter(
    ([k, v]) => JSON.stringify(v) !== JSON.stringify(values[k])))
  const dirtyCount = Object.keys(patch).length

  // 渲染顺序 = 后端声明顺序(有 fields 则用之,否则回退存储行的键);隐藏项(hidden)不出。
  const keys = (Object.keys(fields).length ? Object.keys(fields) : Object.keys(values))
    .filter(k => !fields[k]?.hidden)

  const save = async () => {
    setBusy(true); setNote('')
    try {
      await hubCommand('web/settings/edit_requested', { domain, values: patch })
      setNote('已提交,生效于下一次读取')
      setDrafts({})
      setTimeout(onSaved, 600)
    } catch (e) {
      setNote(e?.response?.data?.error || e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel mb-16">
      <div className="panel-head">
        <Icon name="sliders" size={15} />
        <span className="panel-title">{label || domain}</span>
        <span className="text-mono text-muted" style={{ fontSize: 10 }}>{table}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {note && <span className="text-muted" style={{ fontSize: 11 }}>{note}</span>}
          {dirtyCount === 0 ? (
            <span className="text-muted" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="check" size={13} style={{ color: '#16a34a' }} /> 已保存
            </span>
          ) : (
            <>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24',
                             background: 'rgba(251,191,36,.14)', border: '1px solid rgba(251,191,36,.4)',
                             borderRadius: 10, padding: '1px 9px' }}>
                {dirtyCount} 项待保存
              </span>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
                {busy ? '提交中…' : '保存'}
              </button>
            </>
          )}
        </span>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: '0 24px',
                                           gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {keys.map(k => (
          <Field key={k} name={k} spec={fields[k]} value={values[k]} draft={drafts[k]} voices={voices}
                 onChange={(name, v) => setDrafts(d => ({ ...d, [name]: v }))} />
        ))}
      </div>
    </div>
  )
}

export default function Settings() {
  const [sections, setSections] = useState([])   // [{domain, table, label, values, fields}]
  const [voices, setVoices] = useState([])
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const { data: snap } = await hubSnapshot()
      // 选项引用解析:字段 options 为 "@task_types.<tt>.<字段>" 时,从管线 create_spec 取该字段选项
      // (单一真相源,选项列表只在管线一处;{value,label} → [value,label] 适配 select 控件)。
      const resolveOpts = (ref) => {
        const m = /^@task_types\.([^.]+)\.(.+)$/.exec(ref)
        const fld = m && (snap.task_types?.[m[1]]?.fields || []).find(f => f.name === m[2])
        return (fld?.options || []).map(o => [o.value, o.label])
      }
      const resolveFields = (fields) => Object.fromEntries(
        Object.entries(fields || {}).map(([k, spec]) =>
          [k, (typeof spec?.options === 'string' && spec.options[0] === '@')
                ? { ...spec, options: resolveOpts(spec.options) } : spec]))
      const tables = Object.entries(snap.store || {})
        .filter(([, m]) => m.type === 'envelope' && (m.kinds || []).includes('settings'))
      const out = []
      for (const [table, meta] of tables) {
        const { data } = await hubStore(table, { kind: 'settings', limit: 1 })
        if (data.rows.length) {
          out.push({
            domain: meta.owner, table, values: data.rows[0].data,
            fields: resolveFields(meta.settings_fields), label: meta.settings_label || meta.owner,
          })
        }
      }
      out.sort((a, b) => a.domain.localeCompare(b.domain))
      setSections(out)
      const { data: va } = await hubStore('task_media_assets',
        { kind: 'asset', asset_type: 'voiceprint', limit: 50 })
        .catch(() => ({ data: { rows: [] } }))
      setVoices((va?.rows || []).map(r => r.data).filter(Boolean))
      setError('')
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  useHubEvent('store', (m) => {                  // 设置表存储事件 → 去抖回读(多端同步)
    if (!String(m.table || '').endsWith('_settings') || timerRef.current) return
    timerRef.current = setTimeout(() => { timerRef.current = null; load() }, 400)
  })

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">系统设置</div>
          <div className="page-sub">运行时配置(域数据)· 各域设置表自动发现,改后即刻/下一轮生效</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={load}><Icon name="refresh" size={14} /> 刷新</button>
      </div>
      {error && <div className="alert alert-error mb-16"><Icon name="alert" size={14} /> {error}</div>}
      {sections.length === 0 && !error && (
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <span className="text-muted">尚无域声明设置表</span>
        </div>
      )}
      {sections.map(s => (
        <Section key={s.table} {...s} voices={voices} onSaved={load} />
      ))}
      <div className="text-muted" style={{ fontSize: 11 }}>
        本页只管运行时配置(域数据,改后即刻/下一轮生效)。基建配置在 config.toml(重启级),
        平台密钥在 .env——两者不入库、不在此页。
      </div>
    </div>
  )
}
