// 知识库(名词库):按领域维护术语——term(规范源词)/ translation(译名)/ domains(多领域,可跨频道)
// / aliases(变体拼写)。聚合键=(term,译名):同词同译名在多域出现聚合为一条,domains 里多个 slug。
// S04 术语层按当前频道域匹配 + 收录(A/B),B 云端发现的词也落这表(source=discovered)。
// 读:GET /api/store/task_glossary_terms(域是多值列表,故域筛选在客户端);写:web/kb/* 命令。
import { useCallback, useEffect, useMemo, useState } from 'react'

import { hubStore, hubCommand } from '../api/hub'
import DomainCombo from '../components/DomainCombo'
import useDomains from '../hooks/useDomains'
import Icon from '../components/Icon'

const _row = (r) => ({ id: r.id, ...(r.data || r) })
const _list = (a) => (Array.isArray(a) ? a.join(', ') : (a || ''))
const _split = (s) => String(s || '').split(/[,，]/).map(x => x.trim()).filter(Boolean)

export default function Knowledge() {
  const [domain, setDomain] = useState('')                 // '' = 全部领域(客户端筛选)
  const [status, setStatus] = useState('')                 // '' | active | pending
  const [rows, setRows] = useState([])                     // 全量(按 status 过滤,域在客户端筛)
  const [error, setError] = useState('')
  const { domains, reload: reloadDomains } = useDomains()  // 领域候选(频道域∪术语域)——共享单一来源
  const [form, setForm] = useState({ term: '', translation: '', domains: '', aliases: '' })
  const [edit, setEdit] = useState(null)                   // 编辑中的扁平行(+ domainsStr / aliasesStr)

  const load = useCallback(async () => {
    try {
      const params = { order: 'id:desc', limit: 2000 }
      if (status) params.status = status                   // status 是索引列,可查询
      const { data } = await hubStore('task_glossary_terms', params)
      setRows((data.rows || []).map(_row))
      setError('')
    } catch (e) { setError(String(e?.message || e)) }
  }, [status])

  useEffect(() => { load() }, [load])
  const refresh = () => { setTimeout(load, 400); setTimeout(reloadDomains, 400) }  // 命令异步投递,略等再刷(顺带刷领域候选)
  const shown = useMemo(
    () => (domain ? rows.filter(r => (r.domains || []).includes(domain)) : rows), [rows, domain])

  const add = async (e) => {
    e.preventDefault()
    if (!form.term.trim() || !form.translation.trim()) return
    try {
      await hubCommand('web/kb/term_add_requested', {
        term: form.term.trim(), translation: form.translation.trim(),
        domains: _split(form.domains), aliases: _split(form.aliases),
      })
      setForm({ term: '', translation: '', domains: form.domains, aliases: '' })
      refresh()
    } catch (e) { setError(String(e?.message || e)) }
  }

  const saveEdit = async () => {
    try {
      await hubCommand('web/kb/term_edit_requested', {
        row_id: edit.id,
        values: {
          term: edit.term.trim(), translation: edit.translation.trim(),
          domains: _split(edit.domainsStr), aliases: _split(edit.aliasesStr),
          status: edit.status || 'active',
        },
      })
      setEdit(null); refresh()
    } catch (e) { setError(String(e?.message || e)) }
  }

  const remove = async (id) => {
    if (!window.confirm('删除该术语?')) return
    try { await hubCommand('web/kb/term_remove_requested', { row_id: id }); refresh() }
    catch (e) { setError(String(e?.message || e)) }
  }

  // 点状态标签即切换 生效(active)↔候选(pending):走同一 term_edit 命令(只补 status 字段)
  const toggleStatus = async (r) => {
    const next = r.status === 'pending' ? 'active' : 'pending'
    try {
      await hubCommand('web/kb/term_edit_requested', { row_id: r.id, values: { status: next } })
      refresh()
    } catch (e) { setError(String(e?.message || e)) }
  }

  const clearCandidates = async () => {
    const scope = domain ? `领域「${domain}」的` : '全部'
    if (!window.confirm(`清空${scope}候选词(pending)?确认词(active)不受影响。`)) return
    try {
      await hubCommand('web/kb/candidates_clear_requested', domain ? { domain } : {})
      refresh()
    } catch (e) { setError(String(e?.message || e)) }
  }

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>名词对照</h2>
        <span className="text-muted" style={{ fontSize: 12 }}>
          规范专名 + 译名;domains 多值(可跨频道/领域);aliases 填 ASR 常见错拼(逗号分隔),命中即纠回规范词
        </span>
      </div>

      {/* 新增术语 */}
      <form onSubmit={add} className="card mb-24"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ flex: '1 1 150px' }} placeholder="规范源词(如 Star Citizen)"
          value={form.term} onChange={e => setForm({ ...form, term: e.target.value })} />
        <input className="input" style={{ flex: '1 1 150px' }} placeholder="译名(如 星际公民)"
          value={form.translation} onChange={e => setForm({ ...form, translation: e.target.value })} />
        <DomainCombo value={form.domains} onChange={v => setForm({ ...form, domains: v })}
          options={domains} placeholder="领域 slug(逗号分隔,选填=通用)" style={{ flex: '1 1 150px' }} />
        <input className="input" style={{ flex: '2 1 180px' }} placeholder="别名/错拼(逗号分隔,选填)"
          value={form.aliases} onChange={e => setForm({ ...form, aliases: e.target.value })} />
        <button className="btn" type="submit">新增</button>
      </form>

      {/* 筛选 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <select className="input" style={{ width: 180 }} value={domain}
          onChange={e => setDomain(e.target.value)}>
          <option value="">全部领域</option>
          {domains.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="input" style={{ width: 130 }} value={status}
          onChange={e => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="active">active(生效)</option>
          <option value="pending">pending(候选)</option>
        </select>
        <span className="text-muted" style={{ fontSize: 12 }}>{shown.length} 条</span>
        <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={clearCandidates}
          title="删除候选词(pending);确认词 active 不受影响">🧹 一键清理候选词</button>
      </div>

      {error && <div className="alert alert-error mb-16"><Icon name="alert" size={14} /> {error}</div>}

      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border,#333)' }}>
              <th style={{ padding: '8px 10px' }}>规范词</th>
              <th style={{ padding: '8px 10px' }}>译名</th>
              <th style={{ padding: '8px 10px' }}>领域</th>
              <th style={{ padding: '8px 10px' }}>别名</th>
              <th style={{ padding: '8px 10px' }}>状态</th>
              <th style={{ padding: '8px 10px' }}>来源</th>
              <th style={{ padding: '8px 10px', width: 110 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border-soft,#222)' }}>
                <td style={{ padding: '6px 10px', fontWeight: 600 }}>{r.term}</td>
                <td style={{ padding: '6px 10px' }}>{r.translation}</td>
                <td style={{ padding: '6px 10px', color: 'var(--text-muted,#888)' }}>
                  {_list(r.domains) || <span style={{ opacity: .5 }}>通用</span>}</td>
                <td style={{ padding: '6px 10px', color: 'var(--text-muted,#888)' }}>{_list(r.aliases)}</td>
                <td style={{ padding: '6px 10px' }}>
                  <span role="button" tabIndex={0} onClick={() => toggleStatus(r)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStatus(r) } }}
                    title={r.status === 'pending' ? '点击设为生效(active)' : '点击设为候选(pending)'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                      fontSize: 12, fontWeight: 600, userSelect: 'none',
                      color: r.status === 'pending' ? 'var(--warn-text)' : 'var(--ok-text)' }}>
                    <Icon name={r.status === 'pending' ? 'clock' : 'check'} size={13} />
                    {r.status === 'pending' ? '候选' : '生效'}</span>
                </td>
                <td style={{ padding: '6px 10px', color: 'var(--text-muted,#888)', fontSize: 12 }}>{r.source}</td>
                <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() =>
                    setEdit({ ...r, domainsStr: _list(r.domains), aliasesStr: _list(r.aliases) })}>改</button>
                  <button className="btn btn-sm" style={{ marginLeft: 6 }}
                    onClick={() => remove(r.id)}>删</button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted,#888)' }}>
                暂无术语——用上方表单新增,或跑一次带云端发现(B)的任务自动收录</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 编辑弹窗 */}
      {edit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={() => setEdit(null)}>
          <div className="card" style={{ width: 'min(440px, 92vw)', display: 'flex',
            flexDirection: 'column', gap: 10 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>编辑术语</h3>
            <label style={{ fontSize: 12 }}>规范词
              <input className="input" value={edit.term}
                onChange={e => setEdit({ ...edit, term: e.target.value })} /></label>
            <label style={{ fontSize: 12 }}>译名
              <input className="input" value={edit.translation}
                onChange={e => setEdit({ ...edit, translation: e.target.value })} /></label>
            <label style={{ fontSize: 12 }}>领域 slug(逗号分隔,空=通用)
              <DomainCombo value={edit.domainsStr} onChange={v => setEdit({ ...edit, domainsStr: v })}
                options={domains} /></label>
            <label style={{ fontSize: 12 }}>别名(逗号分隔)
              <input className="input" value={edit.aliasesStr}
                onChange={e => setEdit({ ...edit, aliasesStr: e.target.value })} /></label>
            <label style={{ fontSize: 12 }}>状态
              <select className="input" value={edit.status || 'active'}
                onChange={e => setEdit({ ...edit, status: e.target.value })}>
                <option value="active">active(生效)</option>
                <option value="pending">pending(候选)</option>
              </select></label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn" onClick={() => setEdit(null)}>取消</button>
              <button className="btn btn-primary" onClick={saveEdit}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
