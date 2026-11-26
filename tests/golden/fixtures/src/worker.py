from dataclasses import dataclass


@dataclass
class TaskJob:
    job_id: str
    retries: int = 0


def run_job(job: TaskJob) -> str:
    if job.retries > 3:
        return f"aborted:{job.job_id}"
    return f"ok:{job.job_id}"
