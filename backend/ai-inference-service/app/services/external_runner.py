from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from app.core.settings import settings
from app.schemas.api import (
    InferencePayload,
    InferenceReference,
    InferenceRequest,
    InferenceResponse,
    InferenceVisualizations,
    ResultStorageInfo,
)
from app.services.artifact_persistence import persist_dicom_artifacts


class ExternalRunnerPayload(BaseModel):
    summary: str
    artifactUri: str | None = None
    visualizations: InferenceVisualizations | None = None
    storage: ResultStorageInfo = Field(default_factory=ResultStorageInfo)


class ExternalRunnerArtifacts(BaseModel):
    dicomFiles: list[str] = Field(default_factory=list)


class ExternalRunnerOutput(BaseModel):
    status: Literal['completed', 'failed'] = 'completed'
    resultFormat: str = 'json-external'
    payload: ExternalRunnerPayload
    reference: InferenceReference | None = None
    artifacts: ExternalRunnerArtifacts | None = None
    error: str | None = None


@dataclass(frozen=True)
class ExternalRunnerConfig:
    family: str
    command_env_name: str
    default_result_format: str
    recommended_command: list[str] | None = None
    wrapper_command_env_name: str | None = None
    managed_command_env_name: str | None = None
    managed_runtime_command_env_name: str | None = None

    def _docker_runtime_template_ready(self) -> bool:
        family_key = self.family.upper()
        image_name = os.environ.get(f'AI_INFERENCE_{family_key}_IMAGE', '').strip()
        container_args = os.environ.get(f'AI_INFERENCE_{family_key}_CONTAINER_ARGS_JSON', '').strip()
        if not image_name or not container_args:
            return False

        model_dir = os.environ.get(f'AI_INFERENCE_{family_key}_MODEL_DIR', '').strip()
        if not model_dir:
            default_model_dir = Path.cwd() / 'models' / self.family
            return default_model_dir.exists()

        return Path(model_dir).expanduser().exists()

    @property
    def integration_mode(self) -> str:
        return 'external-runner'

    def is_managed_configured(self) -> bool:
        if not settings.managed_runtimes_enabled:
            return False

        managed_command = (
            os.environ.get(self.managed_command_env_name, '').strip()
            if self.managed_command_env_name
            else ''
        )
        managed_runtime_command = (
            os.environ.get(self.managed_runtime_command_env_name, '').strip()
            if self.managed_runtime_command_env_name
            else ''
        )
        return bool(managed_command or managed_runtime_command or self._docker_runtime_template_ready())

    def is_configured(self) -> bool:
        return bool(os.environ.get(self.command_env_name, '').strip()) or bool(
            self.recommended_command and self.is_managed_configured()
        )

    def configuration_hint(self) -> str:
        base_hint = (
            f'Set {self.command_env_name} to a shell command or JSON command array that reads '
            'request JSON from stdin and writes normalized result JSON to stdout.'
        )

        if not self.recommended_command:
            return base_hint

        wrapper_hint = (
            f' Recommended wrapper: {json.dumps(self.recommended_command)}.'
        )
        if self.wrapper_command_env_name:
            wrapper_hint += (
                f' Then set {self.wrapper_command_env_name} to the real model container or '
                'runtime command that the wrapper should execute.'
            )

        managed_hint = ''
        if self.managed_runtime_command_env_name:
            managed_hint = (
                f' For managed runtimes, set {self.managed_runtime_command_env_name} to the raw '
                'model container or command that the built-in runtime gateway should execute.'
            )
        if self.managed_command_env_name:
            managed_hint += (
                f' Or set {self.managed_command_env_name} to a custom runtime service startup '
                'command that exposes /health and /infer.'
            )

        return f'{base_hint}{wrapper_hint}{managed_hint}'

    def resolve_command(self) -> list[str]:
        raw_command = os.environ.get(self.command_env_name, '').strip()
        if not raw_command:
            if self.recommended_command and self.is_managed_configured():
                return [sys.executable if str(item) == 'python' else str(item) for item in self.recommended_command]

            raise RuntimeError(self.configuration_hint())

        if raw_command.startswith('['):
            parsed = json.loads(raw_command)
            if not isinstance(parsed, list) or not parsed:
                raise RuntimeError(f'{self.command_env_name} must be a non-empty JSON command array')

            return [str(item) for item in parsed]

        return shlex.split(raw_command, posix=os.name != 'nt')


def _extract_json_payload(stdout: str) -> str:
    trimmed = stdout.strip()
    if not trimmed:
        raise RuntimeError('External runner did not return any stdout payload')

    if trimmed.startswith('{'):
        return trimmed

    for line in reversed(trimmed.splitlines()):
        candidate = line.strip()
        if candidate.startswith('{') and candidate.endswith('}'):
            return candidate

    raise RuntimeError('External runner stdout did not contain a JSON object payload')


def get_managed_runtime_url(family: str) -> str:
    port_map = {
        'nnunet': settings.nnunet_runtime_port,
        'yolo': settings.yolo_runtime_port,
        'monai': settings.monai_runtime_port,
    }
    return f'http://{settings.managed_runtime_host}:{port_map[family]}/infer'


def _build_runner_env(config: ExternalRunnerConfig) -> dict[str, str]:
    port_map = {
        'nnunet': settings.nnunet_runtime_port,
        'yolo': settings.yolo_runtime_port,
        'monai': settings.monai_runtime_port,
    }
    env = os.environ.copy()
    env['AI_INFERENCE_MANAGED_RUNTIME_HOST'] = settings.managed_runtime_host
    env[f'AI_INFERENCE_{config.family.upper()}_RUNTIME_PORT'] = str(port_map[config.family])
    return env


def run_external_inference(
    *,
    config: ExternalRunnerConfig,
    request: InferenceRequest,
    job_id: str,
) -> InferenceResponse:
    command = config.resolve_command()
    runner_input = {
        'jobId': job_id,
        'inferenceId': request.inferenceId,
        'modelName': request.modelName,
        'taskType': request.taskType,
        'studyInstanceUID': request.studyInstanceUID,
        'seriesInstanceUID': request.seriesInstanceUID,
        'options': request.options.model_dump(by_alias=True),
    }

    # Each model family executes out-of-process so nnU-Net, YOLO, and MONAI can
    # keep their own dependencies and scheduling strategy without polluting the API.
    completed = subprocess.run(
        command,
        input=json.dumps(runner_input),
        capture_output=True,
        text=True,
        check=False,
        env=_build_runner_env(config),
    )

    if completed.returncode != 0:
        stderr = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(
            f'{config.family} runner exited with code {completed.returncode}: {stderr or "unknown error"}'
        )

    try:
        runner_output = ExternalRunnerOutput.model_validate_json(
            _extract_json_payload(completed.stdout)
        )
    except (ValidationError, json.JSONDecodeError) as error:
        raise RuntimeError(f'{config.family} runner returned invalid JSON payload: {error}') from error

    reference = runner_output.reference or InferenceReference(
        studyInstanceUID=request.studyInstanceUID,
        seriesInstanceUID=request.seriesInstanceUID,
    )
    payload = runner_output.payload

    if runner_output.artifacts and runner_output.artifacts.dicomFiles:
        pass

    persisted_artifacts = persist_dicom_artifacts(
        inference_id=request.inferenceId,
        request=request,
        payload=payload,
        dicom_files=runner_output.artifacts.dicomFiles if runner_output.artifacts else [],
    )

    if persisted_artifacts:
        reference = reference.model_copy(
            update={
                'studyInstanceUID': reference.studyInstanceUID
                or persisted_artifacts.study_instance_uid,
            }
        )
        payload = payload.model_copy(
            update={
                'artifactUri': persisted_artifacts.artifact_uri or payload.artifactUri,
                'storage': payload.storage.model_copy(
                    update={
                        'mode': 'derived-series',
                        'derivedSeriesInstanceUID': (
                            persisted_artifacts.derived_series_instance_uid
                            or payload.storage.derivedSeriesInstanceUID
                        ),
                        'derivedSeriesDescription': (
                            persisted_artifacts.derived_series_description
                            or payload.storage.derivedSeriesDescription
                        ),
                    }
                ),
            }
        )

    return InferenceResponse(
        jobId=job_id,
        inferenceId=request.inferenceId,
        status=runner_output.status,
        modelName=request.modelName,
        taskType=request.taskType,
        resultFormat=runner_output.resultFormat or config.default_result_format,
        reference=reference,
        payload=InferencePayload(
            summary=payload.summary,
            artifactUri=payload.artifactUri,
            visualizations=payload.visualizations,
            storage=payload.storage,
        ),
        error=runner_output.error,
    )
