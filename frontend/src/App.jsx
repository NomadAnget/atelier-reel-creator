// 新系统前端路由:随域移植逐页生长(观测台是第一页)。
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { HubStreamProvider } from './hooks/HubStream'
import { ConfirmHost } from './components/confirm'
import Toaster from './components/Toaster'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Jobs from './pages/Jobs'
import Monitor from './pages/Monitor'
import Knowledge from './pages/Knowledge'
import PublishAccounts from './pages/PublishAccounts'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      {/* 全站唯一 SSE 连接:包住所有路由,切页不断连 */}
      <HubStreamProvider>
        <ConfirmHost />
        <Toaster />
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="monitor" element={<Monitor />} />
            <Route path="knowledge" element={<Knowledge />} />
            <Route path="accounts" element={<PublishAccounts />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </HubStreamProvider>
    </BrowserRouter>
  )
}
