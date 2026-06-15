from dataclasses import dataclass

from app.schemas.api import ModelInfo
from app.services.monai_service import MonaiService
from app.services.nnunet_service import NnUNetService
from app.services.yolo_service import YoloService


@dataclass(frozen=True)
class ModelRegistryEntry:
    name: str
    family: str
    version: str
    task_types: list[str]
    runner: object


# Each family is isolated behind its own runner so the HTTP contract stays stable
# while execution moves to real nnU-Net, YOLO, or MONAI runtimes per deployment.
_entries: dict[str, ModelRegistryEntry] = {
    "nnunet": ModelRegistryEntry(
        name="nnunet",
        family="nnunet",
        version="0.1.0",
        task_types=["segmentation"],
        runner=NnUNetService(),
    ),
    "yolo": ModelRegistryEntry(
        name="yolo",
        family="yolo",
        version="0.1.0",
        task_types=["detection"],
        runner=YoloService(),
    ),
    "monai": ModelRegistryEntry(
        name="monai",
        family="monai",
        version="0.1.0",
        task_types=["segmentation"],
        runner=MonaiService(),
    ),
}


def list_models() -> list[ModelInfo]:
    return [
        ModelInfo(
            name=entry.name,
            family=entry.family,
            version=entry.version,
            taskTypes=entry.task_types,
            integrationMode=entry.runner.runner_config.integration_mode,
            configured=entry.runner.runner_config.is_configured(),
            configurationHint=(
                None
                if entry.runner.runner_config.is_configured()
                else entry.runner.runner_config.configuration_hint()
            ),
        )
        for entry in _entries.values()
    ]


def get_entry(model_name: str) -> ModelRegistryEntry:
    try:
        return _entries[model_name]
    except KeyError as error:
        raise ValueError(f"Unsupported model: {model_name}") from error
