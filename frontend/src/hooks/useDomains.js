import { useCallback, useEffect, useState } from 'react'
import { hubStore } from '../api/hub'

// 已知领域候选(**单一来源**):频道已配域(daemons_channels.domain)∪ 术语已用域
// (task_glossary_terms.domains),去重排序。名词库(Knowledge)与监控源(Monitor)的领域
// 下拉共用此列表——避免两页各写一遍"合并两源"的逻辑(同一派生数据别散落多处)。
// 返回 reload:域被增改后(建/编辑术语、改频道域)由调用方触发,刷新候选。
export default function useDomains() {
  const [domains, setDomains] = useState([])
  const reload = useCallback(() => {
    Promise.all([
      hubStore('daemons_channels', { limit: 500 }).catch(() => ({ data: {} })),
      hubStore('task_glossary_terms', { limit: 2000 }).catch(() => ({ data: {} })),
    ]).then(([ch, kb]) => {
      const chDoms = (ch.data?.rows || []).map(r => String((r.data?.domain ?? r.domain) || '').trim())
      const kbDoms = (kb.data?.rows || []).flatMap(r => (r.data?.domains ?? r.domains) || [])
      setDomains([...new Set([...chDoms, ...kbDoms].filter(Boolean))].sort())
    })
  }, [])
  useEffect(() => { reload() }, [reload])
  return { domains, reload }
}
