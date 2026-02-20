from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from loguru import logger

scheduler = BackgroundScheduler(timezone="UTC")


def _scheduled_library_scan():
    from app.services.scan_service import run_scheduled_scan
    logger.info("Scheduler: starting automatic library scan")
    run_scheduled_scan()


def start_scheduler():
    scheduler.add_job(
        _scheduled_library_scan,
        CronTrigger(hour=3, minute=0),
        id="auto_library_scan",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Background scheduler started")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
    logger.info("Background scheduler stopped")
