# 前端修改计划

> 前端：Vite + React 19。后端零侵入；鉴权走 Authelia + 反代，dev 经 vite 代理到 :8000。

## ✅ 已完成

- **P0 任务轮询优化**：任务列表一次聚合拉取；详情按「运行中→进度 / 审核中→B站状态」精确轮询；
  去除逐任务、逐已发布任务的重复详情请求。
- **发布目标聚合（计划外）**：后端新增 `GET /api/v1/monitor/targets` + `list_all_publish_targets`；
  Dashboard/Monitor 改一次聚合拉取本地分组，消除 N+1。
- **平台类型显示（计划外）**：发布目标/账号显示平台中文名 + 图标（`src/platform.js`）。
- **账号昵称（计划外）**：后端 `platform_connections` 新增 `nickname` 列（独立于 display_name）+
  迁移 + 导入抓取 + 启动回填；前端优先显示昵称、回退 uid。

## ⬜ 进行中 / 待做

- **P1 任务结果详情**：新建详情弹窗，拉 `getJob(id)` 读 `publish_data` 展示
  成品视频路径 / 双语字幕 / 标题描述标签 / timeline 段数 / 各平台发布结果（bvid+链接+错误）。
- **P2 封面显示**：直接用任务自带的 `cover_url`（=`/api/v1/jobs/{id}/cover`）作 `<img src>`，
  替代「从 B站数据兜底取封面」的绕路（本地/未发布任务也能显示）。
- **P3 附加展示（受限）**：`subtitle_status` 已是顶层字段可展示；
  原版2P / 竖版封面 / 字幕去敏状态 **当前 publish_data 不含**，如需展示要后端扩 `_PUBLISH_OUTPUT_KEYS`。

## 约束
纯前端为主，不破坏现有进度条/封面/发布按钮逻辑；贴现有 React 风格。
