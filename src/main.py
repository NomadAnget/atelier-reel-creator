"""atelier-reel-creator 组装入口(产品接线)—— 个人 up 主:频道监控(限5源)+视频翻译+自动发布。

域集 = reel 基座(web/scheduler/task/engines/platform_adapters)+ daemons(监控)+ publishers
(发布,进程域·懒子进程)。gateway 开(进程域懒子进程);supervisor 起 bgutil 边车。
不含 media / pipeline-digest / sentinel;不跑日报排产/采集(监控 auto-job 即建即跑)。
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal

from atelier_core.boot.assembly import (
    Handlers,
    _acquire_single_instance_lock,
    _housekeeping_loop,
    build_hub,
    build_store,
    build_supervisor_and_gateway,
    self_test,
)
from atelier_core.boot.composition import BuildContext
from atelier_core.core import config, logger

DOMAIN_ROOT = __package__
_MAX_CHANNELS = 5          # 个人版:监控源上限
_SHUTDOWN_DEADLINE = 20.0


async def serve(config_path: str | None = None) -> None:
    cfg = config.load(config_path)
    logger.set_level(cfg.logger.level)
    logger.info("基建配置来源:%s", cfg.source, layer="CORE", component="Main")

    lock_fd = _acquire_single_instance_lock(cfg.paths.store_db)
    if lock_fd is None:
        logger.error("已有 hub 独占数据目录 %s,拒绝启动", cfg.paths.store_db,
                     layer="CORE", component="Main")
        return
    import os
    os.environ.setdefault("GCP_MODELS_DIR", cfg.paths.models_dir)

    svc: dict = {}
    scheduler_handlers: Handlers = {
        "on_job_requested":      lambda e: svc["scheduler"].on_job_requested(e),
        "on_job_cancel":         lambda e: svc["scheduler"].on_job_cancel(e),
        "on_job_delete":         lambda e: svc["scheduler"].on_job_delete(e),
        "on_job_republish":      lambda e: svc["scheduler"].on_job_republish(e),
        "on_publish_discard":    lambda e: svc["scheduler"].on_publish_discard(e),
        "on_schedule_due":       lambda e: svc["scheduler"].on_schedule_due(e),
        "on_monitor_discovered": lambda e: svc["scheduler"].on_monitor_discovered(e),
        "on_job_finished":       lambda e: svc["scheduler"].on_job_finished(e),
        "on_job_progress":       lambda e: svc["scheduler"].on_job_progress(e),
        "on_publish_finished":   lambda e: svc["scheduler"].on_publish_finished(e),
        "on_channel_targets_edit": lambda e: svc["scheduler"].on_channel_targets_edit(e),
    }
    from .task import header as _task_header
    _task_rt: dict = {}
    task_handlers: Handlers = {
        slot: (lambda s: lambda e: _task_rt["h"][s](e))(slot)
        for slot in set(_task_header.SUBSCRIBES.values())
    }
    engines_handlers: Handlers = {"on_settings_edit": lambda e: svc["engines_settings_edit"](e)}
    platform_adapters_handlers: Handlers = {
        "on_settings_edit":     lambda e: svc["ingest"].on_settings_edit(e),
        # 监控要采集 cookie → 本域解析(读 publishers_accounts)→ 写成品表 → 回 ready。
        "on_cookies_needed":    lambda e: svc["ingest_cookies"].on_cookies_needed(e),
    }
    # daemons:接监控槽位 → MonitorService;日报采集槽(on_digest_collect/…/on_items_used)不接,
    # 交 fill_noop 空转(本变体无日报)。
    daemons_handlers: Handlers = {
        "on_job_status":          lambda e: svc["monitor"].on_job_status(e),
        "on_job_deleted":         lambda e: svc["monitor"].on_job_deleted(e),
        "on_auth_expired":        lambda e: svc["monitor"].on_auth_expired(e),
        "on_channel_add":         lambda e: svc["monitor"].on_channel_add(e),
        "on_channel_edit":        lambda e: svc["monitor"].on_channel_edit(e),
        "on_channel_remove":      lambda e: svc["monitor"].on_channel_remove(e),
        "on_poll_now":            lambda e: svc["monitor"].on_poll_now(e),
        "on_poll_channel":        lambda e: svc["monitor"].on_poll_channel(e),
        "on_cookies_ready":       lambda e: svc["monitor"].on_cookies_ready(e),
        "on_settings_edit":       lambda e: svc["monitor"].on_settings_edit(e),
        # 本变体无日报:on_digest_source_*/on_digest_collect/… 交 fill_noop 空转(不接 DigestCollector)。
    }
    remote_handlers: dict[str, Handlers] = {
        "scheduler": scheduler_handlers, "task": task_handlers,
        "engines": engines_handlers, "platform_adapters": platform_adapters_handlers,
        "daemons": daemons_handlers,
    }

    # 进程域 + 网关通用装配(发现驱动、零域绑定):建监督器(cfg 边车 + 进程域懒子进程)+ 网关转发/
    # register_lazy。publishers 现为进程域(非远程域)——加 process 域无需改此处/config(见 boot.md 形态 B)。
    supervisor, gateway = build_supervisor_and_gateway(cfg, remote_handlers, DOMAIN_ROOT)

    bus, windows = await build_hub(
        remote_handlers, fill_noop=True, journal_db=cfg.paths.journal_db,
        queue_size=cfg.bus.queue_size, max_attempts=cfg.bus.max_attempts,
        put_timeout=cfg.bus.put_timeout, domain_root=DOMAIN_ROOT)
    if gateway is not None:
        gateway.attach(bus, windows)
        await gateway.start()
    store, store_windows = await build_store(cfg.paths.store_db, domain_root=DOMAIN_ROOT)

    from atelier_core.core.log_store import LogStoreHandler
    log_sink = LogStoreHandler(cfg.paths.store_db, batch=cfg.logstore.batch,
                               flush_interval=cfg.logstore.flush_interval, queue_max=cfg.logstore.queue_max)
    logging.getLogger(logger.ROOT).addHandler(log_sink)

    # engines 设置底座
    from atelier_core.core.settings import SettingsStore, edit_handler
    from .engines.schema import EngineSettings
    engines_settings = SettingsStore(store, store_windows["engines"], "engines_settings",
                                     EngineSettings, layer="ENGINES")
    svc["engines_settings_edit"] = edit_handler(engines_settings, "engines")
    await engines_settings.get()

    # task 域:build 聚合(基础 + pipeline-video)
    from .task import build as task_build
    ctx = BuildContext(hub=store, stores=store_windows, publish=windows["task"],
                       loop=asyncio.get_running_loop(), cfg=cfg, bus=bus)
    _task_rt["h"] = task_build.build(ctx).handlers

    # scheduler(含发布出闸;task 本地无进程域控制器)
    from .scheduler.impl.publish_service import PublishService
    from .scheduler.impl.service import JobSchedulerService
    svc["scheduler"] = JobSchedulerService(
        windows["scheduler"], store, store_windows["scheduler"],
        publish_service=PublishService(windows["scheduler"], store), task_process=None)

    # platform_adapters(YouTube 采集门面,POT 取 bgutil 动态口)
    from .platform_adapters import ingest as pa_ingest
    svc["ingest"] = pa_ingest.init(store, store_windows["platform_adapters"], pot_port=supervisor.child_port("bgutil"))
    # 采集 cookie 成品解析(收 daemons/cookies/needed → 读 publishers_accounts → 写成品表 → 回 ready)
    from .platform_adapters.impl.ingest_cookies import IngestCookieService
    svc["ingest_cookies"] = IngestCookieService(
        windows["platform_adapters"], store, store_windows["platform_adapters"])

    # daemons:频道监控(auto-job 即建即跑;无日报排产/采集)
    from .daemons.impl.monitor.service import MonitorService
    from .daemons.impl.monitor.query import MonitorSourceQuery
    # 监控源上限=变体绑定常量(个人版限 5);发现委托 MonitorSourceQuery(yt-dlp,cookie 读成品表)。
    svc["monitor"] = MonitorService(windows["daemons"], store, store_windows["daemons"],
                                    MonitorSourceQuery(store), max_channels=_MAX_CHANNELS)
    # 发布账号保活/查态调度(执行侧在 publishers 进程域;到点发 daemons/publishers/* 唤醒)
    from .daemons.impl.keepalive.service import PublishersKeepalive
    svc["pub_keepalive"] = PublishersKeepalive(windows["daemons"], store)

    # ── 循环 ────────────────────────────────────────────────────────────────
    tasks = [
        asyncio.create_task(svc["scheduler"].run_worker(), name="scheduler_worker"),
        asyncio.create_task(svc["monitor"].run_loop(), name="monitor_loop"),
        asyncio.create_task(svc["pub_keepalive"].run(), name="pub_keepalive"),
        asyncio.create_task(_housekeeping_loop(bus, store, cfg.retention), name="housekeeping"),
    ]
    await supervisor.start()          # 拉起 bgutil

    # web(单端口 + in-repo 前端:Monitor+Accounts+Jobs)
    web_server = web_task = None
    if cfg.web.enabled and "web" in windows:
        import uvicorn

        from .web.impl.service import build_web_app
        web_app = build_web_app(bus, store, windows["web"], dist_dir=cfg.web.dist_dir or None)
        web_server = uvicorn.Server(uvicorn.Config(
            web_app, host=cfg.web.host, port=cfg.web.port, log_config=None, access_log=False))
        web_task = asyncio.create_task(web_server.serve(), name="web")

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    logger.info("atelier-reel-creator 运行中(%d 域,port=%d,监控源上限=%d)。Ctrl-C 停机",
                len(windows), cfg.web.port, _MAX_CHANNELS, layer="CORE", component="Main")
    await stop.wait()

    logger.info("停机中…", layer="CORE", component="Main")
    supervisor.begin_shutdown()
    if web_server is not None:
        web_app.state.close_streams()
        web_server.should_exit = True
        await asyncio.gather(web_task, return_exceptions=True)
    if gateway is not None:
        await gateway.stop()
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await supervisor.stop()
    await store.close()
    await bus.close()
    if bus.journal is not None:
        await bus.journal.close()
    log_sink.flush(timeout=3.0)
    logging.getLogger(logger.ROOT).removeHandler(log_sink)
    log_sink.shutdown()
    os._exit(0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="atelier-reel-creator 组装入口")
    parser.add_argument("--check", action="store_true", help="声明自检后退出")
    parser.add_argument("--config", default=None, help="基建配置路径(默认 ./config.toml)")
    args = parser.parse_args()
    asyncio.run(self_test(DOMAIN_ROOT) if args.check else serve(args.config))
