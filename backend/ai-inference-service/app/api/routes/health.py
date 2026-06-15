import httpx
from fastapi import APIRouter

from app.core.settings import settings
from app.schemas.api import HealthResponse, RuntimeServiceHealth
from app.services.model_registry import list_models


router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    models = list_models()
    configured_models = {model.name: model for model in models}
    runtime_ports = {
        'nnunet': settings.nnunet_runtime_port,
        'yolo': settings.yolo_runtime_port,
        'monai': settings.monai_runtime_port,
    }

    runtime_services: list[RuntimeServiceHealth] = []
    enabled_runtime_count = 0
    online_runtime_count = 0

    for family, port in runtime_ports.items():
        model = configured_models.get(family)
        configured = bool(model and model.configured)
        enabled = settings.managed_runtimes_enabled and configured
        status = 'disabled'

        if enabled:
            enabled_runtime_count += 1
            try:
                response = httpx.get(
                    f'http://{settings.managed_runtime_host}:{port}/health',
                    timeout=1.0,
                )
                status = 'online' if response.is_success else 'offline'
            except httpx.HTTPError:
                status = 'offline'

            if status == 'online':
                online_runtime_count += 1

        runtime_services.append(
            RuntimeServiceHealth(
                family=family,
                label=model.name if model else family,
                status=status,
                enabled=enabled,
                configured=configured,
                port=port,
            )
        )

    overall_status = (
        'ok'
        if enabled_runtime_count == 0 or online_runtime_count == enabled_runtime_count
        else 'degraded'
    )

    return HealthResponse(
        status=overall_status,
        service=settings.app_name,
        version=settings.app_version,
        availableModels=len(models),
        backendStatus='online',
        enabledRuntimeCount=enabled_runtime_count,
        onlineRuntimeCount=online_runtime_count,
        runtimeServices=runtime_services,
    )
