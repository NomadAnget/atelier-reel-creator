// 主题切换:dark | light,持久化到 localStorage,写入 <html data-theme>。
import { useEffect, useState } from 'react'

const KEY = 'gcp-theme'

function initial() {
  try { return localStorage.getItem(KEY) || 'dark' } catch { return 'dark' }
}

export default function useTheme() {
  const [theme, setTheme] = useState(initial)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
  }, [theme])
  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  return { theme, toggle }
}
