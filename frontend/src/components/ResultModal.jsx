// 任务产出结果弹窗:拉 /api/jobs/{id}/result(展示字段),封面图走 cover?ratio 窄口。
// 只读展示——标题/简介/标签/章节/封面(多比例)/时长/语言/来源;无产出则提示。
import { useEffect, useState } from 'react'
import { hubJobResult } from '../api/hub'
import Icon from './Icon'

const RATIO_LABEL = { '16:9': '16:9 · B站', '4:3': '4:3', '1:1': '1:1', '3:4': '3:4 · 竖版' }
const fmtDur = (s) => {
  s = Math.round(s || 0)
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

export default function ResultModal({ jobId, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [ratio, setRatio] = useState('')       // 当前展示的封面比例
  useEffect(() => {
    hubJobResult(jobId)
      .then(({ data }) => {
        setData(data)
        setRatio(data.cover_ratios?.[0] || '')   // 默认选第一个比例
      })
      .catch((e) => setError(e?.response?.data?.error || e.message))
  }, [jobId])

  return (
    <div onClick={onClose}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card"
           style={{ maxWidth: 720, width: '100%', maxHeight: '85vh', overflowY: 'auto',
                    padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>任务产出结果</span>
          <span className="text-muted"
                style={{ fontFamily: 'monospace', fontSize: 11, marginLeft: 10 }}>
            {(jobId || '').slice(0, 8)}
          </span>
          <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}
                  onClick={onClose}><Icon name="x" size={13} /> 关闭</button>
        </div>

        {error && <div className="alert alert-error"><Icon name="alert" size={14} /> {error}</div>}
        {!data && !error && <div className="text-muted">加载中…</div>}

        {data && (
          <>
            {data.cover_ratios?.length > 0 && (
              <Field label="封面">
                {/* 比例切换标签:单图展示,点标签切换比例 */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  {data.cover_ratios.map((r) => (
                    <span key={r} onClick={() => setRatio(r)}
                          style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600,
                                   padding: '3px 12px', borderRadius: 12,
                                   border: `1px solid ${r === ratio ? 'var(--accent, #2563eb)' : 'var(--border, #30363d)'}`,
                                   background: r === ratio ? 'var(--accent, #2563eb)' : 'transparent',
                                   color: r === ratio ? '#fff' : 'var(--text-muted, #8b949e)' }}>
                      {RATIO_LABEL[r] || r}
                    </span>
                  ))}
                </div>
                {ratio && (
                  <div style={{ display: 'flex', justifyContent: 'center',
                                background: 'var(--gray-100, #161b22)', borderRadius: 8,
                                padding: 12 }}>
                    <img src={`/api/jobs/${jobId}/cover?ratio=${encodeURIComponent(ratio)}`}
                         alt={ratio}
                         style={{ maxWidth: '100%', maxHeight: 340, borderRadius: 8,
                                  border: '1px solid var(--border, #30363d)' }} />
                  </div>
                )}
              </Field>
            )}

            <Field label="标题(长 · B站)">
              <div style={{ fontWeight: 600 }}>{data.title || '—'}</div>
            </Field>
            <Field label="短标题(短视频平台)">
              <div>{data.short_title || '—'}</div>
            </Field>
            <Field label="简介">
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>
                {data.description || '—'}
              </div>
            </Field>
            {data.tags?.length > 0 && (
              <Field label={`标签(${data.tags.length})`}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {data.tags.map((t, i) => (
                    <span key={i} className="tag"
                          style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10,
                                   border: '1px solid var(--border, #30363d)' }}>
                      {t}
                    </span>
                  ))}
                </div>
              </Field>
            )}
            {data.chapters?.length > 0 && (
              <Field label={`章节(${data.chapters.length})`}>
                <div style={{ fontSize: 12 }}>
                  {data.chapters.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8 }}>
                      <span className="text-muted"
                            style={{ fontVariantNumeric: 'tabular-nums', minWidth: 48 }}>
                        {fmtDur(c.start_second)}
                      </span>
                      <span>{c.content}</span>
                    </div>
                  ))}
                </div>
              </Field>
            )}

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <Field label="时长">
                <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmtDur(data.duration_sec)}
                </div>
              </Field>
              <Field label="语言">
                <div>{data.source_lang || '?'} → {data.target_lang || '?'}</div>
              </Field>
              <Field label="字幕轨">
                <div>{data.subtitle_tracks?.length || 0} 条
                  {data.has_orig_video ? ' · 含原版 2P' : ''}</div>
              </Field>
            </div>
            <Field label="来源">
              <div className="text-muted" style={{ fontSize: 12 }}>
                {data.source_channel || '—'}{data.source_title ? ` · ${data.source_title}` : ''}
              </div>
            </Field>
          </>
        )}
      </div>
    </div>
  )
}
