// 手动创建任务(动态表单):任务类型 + 字段规格全由后端声明(snapshot.task_types,
// 各管线自声明),前端纯渲染。加新任务类型 → 其表单自动出现,前端零改动。
//   字段 type:text | select | multiselect | date | bool | publish_targets
//   value_prefix:提交时给值加前缀(如 news_digest 的 date → digest://<date>)
//   提交约定:video_url/target_lang 进顶层,其余进 pipeline_params;
//   publish_targets 非空 → pipeline_params.publish_to_platform=true。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { hubCommand, hubStore } from '../api/hub'
import Icon from './Icon'
import TargetPicker from './TargetPicker'

const TOP_LEVEL = new Set(['video_url', 'target_lang'])   // JobRequested 顶层字段;其余进 pipeline_params
export const PLATFORM_LABEL = { bilibili: '哔哩哔哩', kuaishou: '快手', douyin: '抖音',
  xiaohongshu: '小红书', shipinhao: '视频号' }

/** 发布账号候选(连接表 → 多选项):排除数据源(meta.datasource),只留引擎账号;
 *  label = 昵称 · 平台中文。CreateJobModal 与频道绑定共用同一逻辑。 */
export const connectionsToTargets = (rows) =>
  (rows || [])
    .filter(r => !r.data?.meta?.datasource
              && String(r.data?.provider || '').startsWith('engine_'))
    .map(r => {
      const platform = String(r.data.provider || '').replace(/^engine_/, '')
      const name = r.data.nickname || r.data.display_name || platform
      return { id: r.id, name, platform, label: `${name} · ${PLATFORM_LABEL[platform] || platform}` }
    })

function Field({ f, value, onChange, targets }) {
  const label = (
    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
      {f.label || f.name}{f.required && <span style={{ color: '#dc2626' }}> *</span>}
    </label>
  )
  const help = f.help && <div style={{ fontSize: 11, color: 'var(--text-muted,#8b949e)', marginTop: 3 }}>{f.help}</div>
  const inputStyle = {
    width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6,
    border: '1px solid var(--gray-300,#444c56)', background: 'var(--bg-input,#fff)', color: 'inherit',
  }

  if (f.type === 'select') {
    return (<div>{label}
      <select style={inputStyle} value={value ?? f.default ?? ''} onChange={e => onChange(e.target.value)}>
        {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>{help}</div>)
  }
  if (f.type === 'bool') {
    return (<div><label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
      {f.label || f.name}</label>{help}</div>)
  }
  if (f.type === 'date') {
    return (<div>{label}
      <input type="date" style={inputStyle} value={value ?? ''} onChange={e => onChange(e.target.value)} />{help}</div>)
  }
  if (f.type === 'auto_today') {   // 无输入控件:值恒为今天(见 submit),仅展示说明
    return f.note ? <div style={{ fontSize: 12, color: 'var(--text-muted,#8b949e)', display: 'flex', gap: 4, alignItems: 'center' }}><Icon name="info" size={12} /> {f.note}</div> : null
  }
  if (f.type === 'publish_targets') {
    // 与频道绑定复用同组件:手选账号即配好该边的可见性/声明(值=边对象数组)
    return (<div>{label}
      <TargetPicker accounts={targets} value={value || []} onChange={onChange} />
      {help}</div>)
  }
  // text(默认)
  return (<div>{label}
    <input type="text" style={inputStyle} value={value ?? ''} placeholder={f.placeholder || ''}
           onChange={e => onChange(e.target.value)} />{help}</div>)
}

export default function CreateJobModal({ taskTypes, onClose, onCreated }) {
  const types = useMemo(() => Object.entries(taskTypes || {}), [taskTypes])
  const [taskType, setTaskType] = useState(types[0]?.[0] || '')
  const [values, setValues] = useState({})
  const [targets, setTargets] = useState([])   // 发布账号候选(动态查库)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const spec = taskTypes?.[taskType]
  const fields = spec?.fields || []
  const needsTargets = fields.some(f => f.type === 'publish_targets')

  useEffect(() => { setValues({}); setError('') }, [taskType])   // 切类型清表单

  // publish_targets 字段存在时,查已连接的**发布账号**做候选:
  //   · 排除数据源(meta.datasource,如 YouTube 采集 OAuth,非发布目标);
  //   · 账户名=nickname,平台=provider 去 engine_ 前缀(display_name 是平台数字 UID,不展示)。
  useEffect(() => {
    if (!needsTargets) return
    hubStore('platform_adapters_connections', { limit: 200 })
      .then(({ data }) => setTargets(connectionsToTargets(data.rows)))
      .catch(() => setTargets([]))
  }, [needsTargets, taskType])

  const setField = useCallback((name, v) => setValues(p => ({ ...p, [name]: v })), [])

  const submit = async () => {
    const today = () => new Date().toLocaleDateString('sv')   // 本地时区 YYYY-MM-DD
    // 校验必填(auto_today 无需用户填,自动取今天,跳过校验)
    for (const f of fields) {
      if (f.required && f.type !== 'auto_today' && !values[f.name]) {
        setError(`请填写「${f.label || f.name}」`); return
      }
    }
    // 组装:顶层字段 vs pipeline_params;value_prefix 应用;publish_targets → 发布意图
    const payload = { task_type: taskType, pipeline_params: {} }
    for (const f of fields) {
      let v = f.type === 'auto_today' ? today() : values[f.name]
      if (v == null || v === '') continue
      if (f.value_prefix) v = f.value_prefix + v
      if (f.name === 'publish_targets') {
        if (Array.isArray(v) && v.length) {
          payload.pipeline_params.publish_targets = v
          payload.pipeline_params.publish_to_platform = true
        }
        continue
      }
      if (TOP_LEVEL.has(f.name)) payload[f.name] = v
      else payload.pipeline_params[f.name] = v
    }
    if (!Object.keys(payload.pipeline_params).length) delete payload.pipeline_params

    setSubmitting(true); setError('')
    try {
      await hubCommand('web/job/requested', payload)
      onCreated?.()
      onClose()
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px',
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{
        width: '100%', maxWidth: 460, padding: 20, maxHeight: '84vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>新建任务</h3>
          <button className="btn btn-outline btn-sm" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>

        {types.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--text-muted,#8b949e)' }}>无可创建的任务类型</div>
          : <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>任务类型</label>
              <select value={taskType} onChange={e => setTaskType(e.target.value)} style={{
                width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6,
                border: '1px solid var(--gray-300,#444c56)', background: 'var(--bg-input,#fff)', color: 'inherit',
              }}>
                {types.map(([t, s]) => <option key={t} value={t}>{s.label || t}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {fields.map(f => (
                <Field key={f.name} f={f} value={values[f.name]} targets={targets}
                       onChange={v => setField(f.name, v)} />
              ))}
            </div>

            {error && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 12 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-outline btn-sm" onClick={onClose}>取消</button>
              <button className="btn btn-sm" style={{ background: '#2563eb', color: '#fff' }}
                      disabled={submitting} onClick={submit}>
                {submitting ? '提交中…' : '创建'}
              </button>
            </div>
          </>}
      </div>
    </div>
  )
}
