from threading import Lock

from app.schemas.api import InferenceResponse


class ResultStore:
    def __init__(self) -> None:
        # In-memory storage keeps smoke tests cheap. Production deployments should
        # replace this with persistent result storage plus artifact metadata.
        self._results: dict[str, InferenceResponse] = {}
        self._lock = Lock()

    def save(self, result: InferenceResponse) -> None:
        with self._lock:
            self._results[result.inferenceId] = result

    def get(self, inference_id: str) -> InferenceResponse | None:
        with self._lock:
            return self._results.get(inference_id)


result_store = ResultStore()
