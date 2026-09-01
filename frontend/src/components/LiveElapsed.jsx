// 行级动态计时:只有这一小块订阅节拍,重渲染范围=它自己,不牵连父组件/
// 列表其余行——性能开销只和"当前有多少个在跑"成正比,和加载了多少行/多少
// 任务无关。用 intervalMs 单独控制这一处的跳字频率(默认 1s;日志页的
// "进行中"徽章用得更密,传 100 即可,不影响其它地方)。
import useTicker from '../hooks/useTicker'

export default function LiveElapsed({ anchor, render, intervalMs = 1000 }) {
  useTicker(true, intervalMs)
  return render(Math.max(0, Date.now() / 1000 - (anchor || 0)))
}
