from threading import Lock

from app.schemas.api import JobStatusResponse


class InMemoryJobQueue:
    def __init__(self) -> None:
        # This queue only tracks status for the current process lifetime.
        self._jobs: dict[str, JobStatusResponse] = {}
        self._lock = Lock()

    def save(self, job: JobStatusResponse) -> None:
        with self._lock:
            self._jobs[job.jobId] = job

    def get(self, job_id: str) -> JobStatusResponse | None:
        with self._lock:
            return self._jobs.get(job_id)


job_queue = InMemoryJobQueue()
