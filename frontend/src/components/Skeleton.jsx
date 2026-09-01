// 骨架屏占位块:数据加载中替代空白,微光扫过。
export default function Skeleton({ width = '100%', height = 16, style }) {
  return <div className="skeleton" style={{ width, height, ...style }} />
}
