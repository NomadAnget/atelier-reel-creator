# atelier-reel-creator

**Atelier 变体:面向个人 up 主** —— 绑定频道监控(限 **5** 源)+ 视频翻译管线 + **自动发布**。

> **宪法在内核仓**:体系的架构/契约/纪律以 [atelier-core/docs/](http://debian.lan:3257/Carnation/atelier-core/src/branch/master/docs)(CONSTITUTION + architecture/bus/storage/domains/boot/logging)为准。本 README 只给本变体的组装与运行导引。


绑定最多 5 个源频道 → 监控发现新视频 → 自动建翻译任务 → 本地化配音成片 → 按绑定的发布目标自动出闸发布。

## 组成
- **内核**:`atelier-core`(uv 依赖)
- **域子模块**(`src/<域>`):web · scheduler · task · engines · platform_adapters · **daemons**(监控)· **publishers**(发布,远程域)
- **管线**:`src/pipelines/video`
- **服务子模块**(`src/services/`):**publish-engine**(publishers 远程实现,经网关接入)· **bgutil-server**(YouTube POT 供给器,node)
- **前端**:in-repo,改自全功能前端(Monitor 频道管理 + PublishAccounts 发布账号 + Jobs 任务;去 Digest)

不含:media / pipeline-digest / sentinel。

## 关键点
- **5 源上限**:`daemons_settings.max_channels`,main.py 启动钉为 5;`add_channel` 超限拒绝,前端也限。
- **自动发布**:gateway 开(`remote_domains=["publishers"]`),publish-engine 经 ws 接入;频道绑发布目标 → 出闸自动发。需 publish-engine + 平台 OAuth 账号。
- **POT**:bgutil 边车(supervisor 动态端口),YouTube 采集防风控。

## 跑
```bash
git submodule update --init --recursive
# 边车构建(一次性):bgutil —— 在 server/ 子目录(package-lock 在那)装依赖 + tsc 编译 src→build/main.js
cd src/services/bgutil-server/server && npm ci && npx tsc && cd -
# publish-engine 无需手动:supervisor 用 `uv run python run.py` 首次自建其 env(自装依赖)
# 前端构建(改自全功能前端)
cd frontend && npm ci && npm run build && cd -
uv sync                              # 或本机借 Architecture 胖 venv(见 reel-solo README B 法)
uv run python -m src.main --config config.toml
```
