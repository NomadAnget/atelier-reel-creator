// 新系统(src)API 客户端 —— 通用端点:路由从声明推导,前端不再对接口清单。
// dev 经 vite 代理 /api → serve(8200);生产由 web 域直接伺服本前端,相对路径直达。
import axios from 'axios'
import { toast } from '../components/toast'

const http = axios.create({ baseURL: '', timeout: 15000 })

export const hubSnapshot = () => http.get('/api/snapshot')                      // 拓扑+存储+账本
export const hubStore = (table, params = {}) =>                                 // 通用查询(声明列白名单)
  http.get(`/api/store/${table}`, { params })

// topic → 操作名(web 域 PUBLISHES 白名单的中文提示)
const COMMAND_LABEL = {
  'web/job/requested': '任务',
  'web/job/cancel_requested': '取消任务',
  'web/job/delete_requested': '删除任务',
  'web/job/republish_requested': '重新发布',
  'web/job/publish_discard_requested': '放弃发布',
  'web/digest/collect_requested': '日报采集',
  'web/digest/collect_source_requested': '采集单源',
  'web/digest/pool_edit_requested': '资讯池编辑',
  'web/monitor/channel_add_requested': '添加频道',
  'web/monitor/channel_edit_requested': '编辑频道',
  'web/monitor/channel_remove_requested': '移除频道',
  'web/channel/targets_edit_requested': '编辑绑定',
  'web/monitor/poll_requested': '立即轮询',
  'web/monitor/poll_channel_requested': '轮询频道',
  'web/monitor/digest_source_add_requested': '添加资讯源',
  'web/monitor/digest_source_edit_requested': '编辑资讯源',
  'web/monitor/digest_source_remove_requested': '移除资讯源',
  'web/engine/login_requested': '引擎登录',
  'web/engine/account_delete_requested': '删除账号',
  'web/engine/check_requested': '引擎对账',
  'web/settings/edit_requested': '保存设置',
}

const short8 = (v) => String(v || '').slice(0, 8)

// 从 payload/corr 提取任务标识(job_id 优先;无则取 YouTube 视频 id)用于提示
function jobHint(payload, corr) {
  const p = payload || {}
  const id = p.job_id || corr
  if (id) return ` · job=${short8(id)}`
  const m = String(p.video_url || '').match(/[?&]v=([^&]+)/)
  if (m) return ` · ${short8(m[1])}`
  return p.video_url ? ` · ${short8(p.video_url)}` : ''
}

// 通用命令(web 域 PUBLISHES 白名单);成功提示 = 操作类型 + 任务标识,仍全局通用。
export const hubCommand = (topic, payload, corr = null, label = null) =>
  http.post(`/api/command/${topic}`, payload,
    corr ? { headers: { 'x-correlation-id': corr } } : undefined)
    .then(res => {
      const name = label || COMMAND_LABEL[topic] || '命令'
      toast(`${name}已提交${jobHint(payload, corr)}`, 'success', 1600)
      return res
    })
    .catch(e => { toast(e?.response?.data?.error || e.message || '命令失败', 'error', 4200); throw e })
export const hubJobResult = (jobId) => http.get(`/api/jobs/${jobId}/result`)    // 任务产出结果(结果弹窗)
export const HUB_STREAM_URL = '/api/stream'                                 // SSE(消息+存储事件)
