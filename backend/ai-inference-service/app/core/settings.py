from dataclasses import dataclass, field
import json
import os


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_csv_env(name: str, default: str) -> tuple[str, ...]:
    raw_value = os.getenv(name, default)
    return tuple(item.strip() for item in raw_value.split(",") if item.strip())


def _parse_json_env(name: str) -> dict[str, str]:
    raw_value = os.getenv(name)
    if not raw_value:
        return {}

    parsed = json.loads(raw_value)
    if not isinstance(parsed, dict):
        raise ValueError(f"{name} must be a JSON object")

    return {str(key): str(value) for key, value in parsed.items()}


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("AI_INFERENCE_APP_NAME", "OHIF AI Inference Service")
    app_version: str = os.getenv("AI_INFERENCE_APP_VERSION", "0.1.0")
    host: str = os.getenv("AI_INFERENCE_HOST", "127.0.0.1")
    port: int = int(os.getenv("AI_INFERENCE_PORT", "8000"))
    reload: bool = _parse_bool(os.getenv("AI_INFERENCE_RELOAD"), False)
    default_result_format: str = os.getenv("AI_INFERENCE_RESULT_FORMAT", "json-stub")
    artifact_base_uri: str = os.getenv(
        "AI_INFERENCE_ARTIFACT_BASE_URI", "file:///tmp/ohif-ai-inference"
    )
    artifacts_dir: str = os.getenv(
        "AI_INFERENCE_ARTIFACTS_DIR",
        os.path.join(os.getcwd(), "artifacts"),
    )
    orthanc_base_url: str | None = os.getenv("AI_INFERENCE_ORTHANC_BASE_URL")
    dicomweb_stow_url: str | None = os.getenv("AI_INFERENCE_DICOMWEB_STOW_URL")
    dicomweb_retrieve_base_url: str | None = os.getenv("AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL")
    dicomweb_headers: dict[str, str] = field(
        default_factory=lambda: _parse_json_env("AI_INFERENCE_DICOMWEB_HEADERS_JSON")
    )
    dicomweb_timeout_seconds: float = float(
        os.getenv("AI_INFERENCE_DICOMWEB_TIMEOUT_SECONDS", "60")
    )
    derived_series_enabled: bool = _parse_bool(
        os.getenv("AI_INFERENCE_DERIVED_SERIES_ENABLED"), True
    )
    managed_runtimes_enabled: bool = _parse_bool(
        os.getenv("AI_INFERENCE_MANAGED_RUNTIMES_ENABLED"), False
    )
    managed_runtime_host: str = os.getenv("AI_INFERENCE_MANAGED_RUNTIME_HOST", "127.0.0.1")
    managed_runtime_startup_timeout_seconds: float = float(
        os.getenv("AI_INFERENCE_MANAGED_RUNTIME_STARTUP_TIMEOUT_SECONDS", "30")
    )
    nnunet_runtime_port: int = int(os.getenv("AI_INFERENCE_NNUNET_RUNTIME_PORT", "8101"))
    yolo_runtime_port: int = int(os.getenv("AI_INFERENCE_YOLO_RUNTIME_PORT", "8102"))
    monai_runtime_port: int = int(os.getenv("AI_INFERENCE_MONAI_RUNTIME_PORT", "8103"))
    cors_allowed_origins: tuple[str, ...] = field(
        default_factory=lambda: _parse_csv_env(
            "AI_INFERENCE_CORS_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000"
        )
    )


settings = Settings()
