import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 新系统前端(web 域客户端半):后端只有一个 = src serve 的 web 服务(默认 8200)。
// 被组装点拉起时经 env 注入(VITE_PORT / VITE_HUB_TARGET),独立调试回退默认。
const PORT = Number(process.env.VITE_PORT) || 5180
const HUB_TARGET = process.env.VITE_HUB_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: PORT,
    host: true,
    proxy: {
      '/api': { target: HUB_TARGET, changeOrigin: true },
    },
  },
})
