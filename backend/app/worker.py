"""One background worker. Runs live in SQLite, so a restart picks up where it left off."""

import asyncio
import logging

from .pipeline import Pipeline

log = logging.getLogger("proofpick.worker")


class Worker:
    def __init__(self, pipeline: Pipeline, idle_seconds: float = 1.0):
        self.pipeline = pipeline
        self.idle_seconds = idle_seconds

    async def tick(self) -> int:
        run_ids = self.pipeline.store.active_run_ids()
        for run_id in run_ids:
            await self.pipeline.advance(run_id)
        return len(run_ids)

    async def run_forever(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception:
                log.exception("Worker tick failed")
            await asyncio.sleep(self.idle_seconds)
