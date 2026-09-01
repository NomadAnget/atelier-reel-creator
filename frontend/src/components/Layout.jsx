// 布局:分组侧栏(桌面可折叠成图标条)+ 顶栏全局实时状态簇。图标统一走 Icon(SVG 单色)。
// 折叠 = 条件渲染:文字(logo 文本/分组标签/导航文字/版本号/在线态)在折叠时直接不渲染,
// 只留图标与折叠按钮,不依赖 CSS 隐藏,更稳。
import { useState, useEffect, Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import useIsMobile from '../hooks/useIsMobile'
import useHubStream from '../hooks/useHubStream'
import useTheme from '../hooks/useTheme'
import Icon from './Icon'
import { hubSnapshot } from '../api/hub'

const navGroups = [
  { label: '概览', items: [
    { to: '/', label: '系统总览', icon: 'dashboard', end: true },
  ] },
  { label: '业务', items: [
    { to: '/monitor', label: '频道监控', icon: 'antenna' },
    { to: '/jobs', label: '任务管理', icon: 'clipboard' },
    { to: '/knowledge', label: '名词对照', icon: 'database' },
    { to: '/accounts', label: '发布账号', icon: 'send' },
  ] },
  { label: '设置', items: [
    { to: '/settings', label: '系统设置', icon: 'sliders' },
  ] },
]

const pageTitles = {
  '/': '系统总览',
  '/monitor': '频道监控',
  '/jobs': '任务管理',
  '/knowledge': '名词对照',
  '/accounts': '发布账号',
  '/settings': '系统设置',
}

export default function Layout() {
  const { pathname } = useLocation()
  const title = pageTitles[pathname] ?? 'GCP'
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)   // 桌面侧栏折叠成图标条
  const [version, setVersion] = useState('')
  const { theme, toggle } = useTheme()

  const { connected, rate, snap } = useHubStream()
  const dead = snap?.journal?.dead ?? 0

  useEffect(() => {
    hubSnapshot().then(({ data }) => setVersion(data.version || '')).catch(() => {})
  }, [])

  const collapseOn = collapsed && !isMobile

  return (
    <div className={`layout${collapseOn ? ' collapsed' : ''}`}>
      {isMobile && drawerOpen && (
        <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />
      )}
      <aside className={`sidebar${isMobile && drawerOpen ? ' open' : ''}${collapseOn ? ' collapsed' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon">G</div>
          {!collapseOn && (
            <div className="logo-block">
              <div className="logo-text">GCP</div>
              <div className="logo-sub">GlobalContentProvider</div>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navGroups.map(g => (
            <div className="nav-group" key={g.label}>
              {!collapseOn && <div className="nav-group-label">{g.label}</div>}
              {g.items.map(({ to, label, icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  title={label}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <Icon name={icon} size={17} />
                  {!collapseOn && <span className="nav-label">{label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!collapseOn && (
            <div className="footer-left">
              <span className="ver">v{version || '—'}</span>
              <span className="status-dot pulse" style={{ color: connected ? 'var(--success)' : 'var(--gray-400)' }}>
                {connected ? '在线' : '连接中'}
              </span>
            </div>
          )}
          <button className="sidebar-collapse" title={collapsed ? '展开侧栏' : '折叠侧栏'}
                  onClick={() => setCollapsed(v => !v)}>
            <Icon name={collapsed ? 'chevronsRight' : 'chevronsLeft'} size={16} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            {isMobile && (
              <button className="hamburger" aria-label="菜单" onClick={() => setDrawerOpen(v => !v)}>☰</button>
            )}
            <span className="topbar-title">{title}</span>
          </div>
          <div className="topbar-status">
            <span className={`status-pill${connected ? ' on' : ''}`}>
              <span className="dot" />SSE {connected ? '已连接' : '连接中'}
            </span>
            <span className="status-pill hide-mobile">
              {rate > 0 ? `↟ ${rate} msg/s` : '— msg/s'}
            </span>
            <span className={`status-pill${dead > 0 ? ' bad' : ''}`}>
              <span className="dot" />死信 {dead}
            </span>
            <button className="theme-toggle" title={theme === 'dark' ? '切换亮色' : '切换暗色'} onClick={toggle}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
          </div>
        </header>

        <main className="page">
          <Suspense fallback={<div className="empty-state"><span className="spinner" /></div>}>
            <div key={pathname} className="page-fade"><Outlet /></div>
          </Suspense>
        </main>
      </div>
    </div>
  )
}
