"""SQLite for runs and jobs, plus a private directory for images. All state survives a restart."""

import json
import shutil
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, path TEXT NOT NULL, width INTEGER, height INTEGER,
  is_sample INTEGER NOT NULL DEFAULT 0, youcam_file_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, original_text TEXT NOT NULL, requirements TEXT NOT NULL,
  photo_id TEXT, state TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, session_id TEXT NOT NULL, product_id TEXT NOT NULL,
  attempt INTEGER NOT NULL, status TEXT NOT NULL, youcam_task_id TEXT, garment_file_id TEXT, output_path TEXT,
  error TEXT, inspection TEXT, next_poll_at REAL NOT NULL DEFAULT 0, submitted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS runs_state ON runs(state);
CREATE INDEX IF NOT EXISTS jobs_run ON jobs(run_id);
"""
ACTIVE_RUN_STATES = ("queued", "checking", "ranking", "previewing")
ACTIVE_JOB_STATUSES = ("pending", "running", "inspecting")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, var_dir: Path):
        self.var_dir = Path(var_dir)
        self.var_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(self.var_dir / "proofpick.db", check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        # Added after the first release; older databases get the column here.
        if "cached" not in {r["name"] for r in self._db.execute("PRAGMA table_info(jobs)")}:
            self._db.execute("ALTER TABLE jobs ADD COLUMN cached INTEGER NOT NULL DEFAULT 0")
        self._db.commit()

    def _write(self, sql: str, params: tuple = ()) -> None:
        with self._lock:
            self._db.execute(sql, params)
            self._db.commit()

    def _one(self, sql: str, params: tuple = ()) -> dict | None:
        with self._lock:
            row = self._db.execute(sql, params).fetchone()
        return dict(row) if row else None

    def _all(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._db.execute(sql, params).fetchall()]

    # Sessions
    def ensure_session(self, session_id: str | None) -> str:
        if session_id and self._one("SELECT id FROM sessions WHERE id=?", (session_id,)):
            return session_id
        session_id = uuid.uuid4().hex
        self._write("INSERT INTO sessions VALUES (?,?)", (session_id, now()))
        return session_id

    def session_exists(self, session_id: str) -> bool:
        return self._one("SELECT id FROM sessions WHERE id=?", (session_id,)) is not None

    def session_dir(self, session_id: str) -> Path:
        path = self.var_dir / "sessions" / session_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def delete_session(self, session_id: str) -> None:
        with self._lock:
            for table, column in (("jobs", "session_id"), ("runs", "session_id"), ("photos", "session_id"), ("sessions", "id")):
                self._db.execute(f"DELETE FROM {table} WHERE {column}=?", (session_id,))
            self._db.commit()
        shutil.rmtree(self.var_dir / "sessions" / session_id, ignore_errors=True)

    # Photos
    def add_photo(self, session_id: str, data: bytes, width: int, height: int, is_sample: bool = False) -> str:
        photo_id = uuid.uuid4().hex
        path = self.session_dir(session_id) / f"photo_{photo_id}.jpg"
        path.write_bytes(data)
        self._write("INSERT INTO photos VALUES (?,?,?,?,?,?,?,?)",
                    (photo_id, session_id, str(path), width, height, int(is_sample), None, now()))
        return photo_id

    def get_photo(self, photo_id: str) -> dict | None:
        return self._one("SELECT * FROM photos WHERE id=?", (photo_id,))

    def set_photo_file_id(self, photo_id: str, file_id: str) -> None:
        self._write("UPDATE photos SET youcam_file_id=? WHERE id=?", (file_id, photo_id))

    # Runs
    def create_run(self, session_id: str, original_text: str, requirements: dict, photo_id: str | None) -> str:
        run_id = uuid.uuid4().hex
        stamp = now()
        self._write("INSERT INTO runs (id,session_id,original_text,requirements,photo_id,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                    (run_id, session_id, original_text, json.dumps(requirements), photo_id, "queued", stamp, stamp))
        return run_id

    def get_run(self, run_id: str) -> dict | None:
        run = self._one("SELECT * FROM runs WHERE id=?", (run_id,))
        if run:
            run["requirements"] = json.loads(run["requirements"])
            run["data"] = json.loads(run["data"])
        return run

    def update_run(self, run_id: str, state: str | None = None, data: dict | None = None, error: str | None = None) -> None:
        fields, params = ["updated_at=?"], [now()]
        if state is not None:
            fields.append("state=?"); params.append(state)
        if data is not None:
            fields.append("data=?"); params.append(json.dumps(data))
        if error is not None:
            fields.append("error=?"); params.append(error)
        self._write(f"UPDATE runs SET {', '.join(fields)} WHERE id=?", (*params, run_id))

    def active_run_ids(self) -> list[str]:
        marks = ",".join("?" * len(ACTIVE_RUN_STATES))
        return [r["id"] for r in self._all(f"SELECT id FROM runs WHERE state IN ({marks}) ORDER BY created_at", ACTIVE_RUN_STATES)]

    def runs_for_session(self, session_id: str) -> list[dict]:
        runs = self._all("SELECT * FROM runs WHERE session_id=? ORDER BY created_at DESC", (session_id,))
        for run in runs:
            run["requirements"] = json.loads(run["requirements"])
            run["data"] = json.loads(run["data"])
        return runs

    def count_runs(self, session_id: str) -> int:
        return self._one("SELECT COUNT(*) AS n FROM runs WHERE session_id=?", (session_id,))["n"]

    # Try-on jobs
    def create_job(self, run_id: str, session_id: str, product_id: str, attempt: int, status: str = "pending", error: str | None = None) -> str:
        job_id = uuid.uuid4().hex
        stamp = now()
        self._write("INSERT INTO jobs (id,run_id,session_id,product_id,attempt,status,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (job_id, run_id, session_id, product_id, attempt, status, error, stamp, stamp))
        return job_id

    def has_job(self, run_id: str, product_id: str) -> bool:
        return self._one("SELECT id FROM jobs WHERE run_id=? AND product_id=?", (run_id, product_id)) is not None

    def jobs_for_run(self, run_id: str) -> list[dict]:
        jobs = self._all("SELECT * FROM jobs WHERE run_id=? ORDER BY created_at, attempt", (run_id,))
        for job in jobs:
            job["inspection"] = json.loads(job["inspection"]) if job["inspection"] else None
        return jobs

    def get_job(self, job_id: str) -> dict | None:
        job = self._one("SELECT * FROM jobs WHERE id=?", (job_id,))
        if job:
            job["inspection"] = json.loads(job["inspection"]) if job["inspection"] else None
        return job

    def update_job(self, job_id: str, **fields) -> None:
        if "inspection" in fields and fields["inspection"] is not None:
            fields["inspection"] = json.dumps(fields["inspection"])
        fields["updated_at"] = now()
        assignments = ", ".join(f"{k}=?" for k in fields)
        self._write(f"UPDATE jobs SET {assignments} WHERE id=?", (*fields.values(), job_id))

    def previews_used(self, session_id: str) -> int:
        """First attempts that reached YouCam or are queued to. Failures before submission do not count."""
        return self._one("SELECT COUNT(*) AS n FROM jobs WHERE session_id=? AND attempt=1 AND (youcam_task_id IS NOT NULL OR status='pending')",
                         (session_id,))["n"]

    def retries_used(self, session_id: str) -> int:
        return self._one("SELECT COUNT(*) AS n FROM jobs WHERE session_id=? AND attempt>1", (session_id,))["n"]

    def tasks_submitted_today(self) -> int:
        today = datetime.now(timezone.utc).date().isoformat()
        return self._one("SELECT COUNT(*) AS n FROM jobs WHERE submitted_at LIKE ?", (f"{today}%",))["n"]
