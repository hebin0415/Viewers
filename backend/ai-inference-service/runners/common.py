from __future__ import annotations

import json
import os
import shlex
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any, Callable

import httpx


JsonDict = dict[str, Any]
AdapterFn = Callable[[JsonDict, JsonDict, dict[str, str]], JsonDict]


@dataclass(frozen=True)
class WrapperConfig:
    family: str
    raw_command_env_name: str


_DEFAULT_PORTS = {
    'nnunet': '8101',
    'yolo': '8102',
    'monai': '8103',
}

_DEFAULT_TIMEOUT_SECONDS = {
    'nnunet': 1800.0,
    'yolo': 300.0,
    'monai': 300.0,
}


def _extract_json_payload(stdout: str) -> JsonDict:
    trimmed = stdout.strip()
    if not trimmed:
        raise RuntimeError('Wrapper command did not return any JSON payload')

    if trimmed.startswith('{'):
        return json.loads(trimmed)

    for line in reversed(trimmed.splitlines()):
        candidate = line.strip()
        if candidate.startswith('{') and candidate.endswith('}'):
            return json.loads(candidate)

    raise RuntimeError('Wrapper command stdout did not contain a JSON object payload')


def _resolve_command(raw_command: str, context: dict[str, str]) -> list[str]:
    if raw_command.startswith('['):
        parsed = json.loads(raw_command)
        if not isinstance(parsed, list) or not parsed:
            raise RuntimeError('Wrapper command must be a non-empty JSON command array')

        return [_format_known_placeholders(str(item), context) for item in parsed]

    return shlex.split(_format_known_placeholders(raw_command, context), posix=os.name != 'nt')


def _format_known_placeholders(template: str, context: dict[str, str]) -> str:
    pattern = re.compile(r'\{([a-zA-Z_][a-zA-Z0-9_]*)\}')
    return pattern.sub(lambda match: context.get(match.group(1), match.group(0)), template)


def resolve_runtime_work_path(path_value: str, context: dict[str, str]) -> str:
    work_dir = context.get('work_dir', '').strip()
    if not work_dir:
        return path_value

    normalized = path_value.replace('\\', '/').strip()
    lowered = normalized.lower()
    prefixes = ('/runtime/work/', 'c:/runtime/work/')

    for prefix in prefixes:
        if lowered.startswith(prefix):
            relative_parts = [part for part in normalized[len(prefix) :].split('/') if part]
            return str(Path(work_dir, *relative_parts))

    return path_value


def _managed_runtime_timeout_seconds(config: WrapperConfig) -> float:
    family_env_name = f'AI_INFERENCE_{config.family.upper()}_MANAGED_RUNTIME_TIMEOUT_SECONDS'
    configured_value = os.environ.get(family_env_name) or os.environ.get(
        'AI_INFERENCE_MANAGED_RUNTIME_TIMEOUT_SECONDS'
    )

    if configured_value:
        return float(configured_value)

    return _DEFAULT_TIMEOUT_SECONDS.get(config.family, 300.0)


def _invoke_managed_runtime(config: WrapperConfig, request: JsonDict) -> JsonDict:
    host = os.environ.get('AI_INFERENCE_MANAGED_RUNTIME_HOST', '127.0.0.1')
    port = os.environ.get(
        f'AI_INFERENCE_{config.family.upper()}_RUNTIME_PORT',
        _DEFAULT_PORTS[config.family],
    )
    response = httpx.post(
        f'http://{host}:{port}/infer',
        json=request,
        timeout=_managed_runtime_timeout_seconds(config),
    )

    if response.is_error:
        detail = response.text.strip()

        try:
            payload = response.json()
            if isinstance(payload, dict) and payload.get('detail'):
                detail = str(payload['detail'])
        except ValueError:
            pass

        raise RuntimeError(
            f'{config.family} managed runtime returned {response.status_code}: '
            f'{detail or response.reason_phrase}'
        )

    return response.json()


def run_wrapper(config: WrapperConfig, adapter: AdapterFn) -> int:
    request = json.loads(input())
    raw_command = os.environ.get(config.raw_command_env_name, '').strip()
    work_dir = Path(tempfile.mkdtemp(prefix=f'ai-{config.family}-wrapper-')).resolve()
    request_path = work_dir / 'request.json'
    response_path = work_dir / 'response.json'
    request_path.write_text(json.dumps(request), encoding='utf-8')

    context = {
        'work_dir': str(work_dir),
        'request_json': str(request_path),
        'response_json': str(response_path),
        'inference_id': request['inferenceId'],
        'study_uid': request.get('studyInstanceUID') or '',
        'series_uid': request.get('seriesInstanceUID') or '',
        'task_type': request['taskType'],
        'model_name': request['modelName'],
    }

    if raw_command:
        completed = subprocess.run(
            _resolve_command(raw_command, context),
            input=json.dumps(request),
            capture_output=True,
            text=True,
            check=False,
        )

        if completed.returncode != 0:
            stderr = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(
                f'{config.family} wrapper command exited with code {completed.returncode}: '
                f'{stderr or "unknown error"}'
            )

        raw_output = (
            json.loads(response_path.read_text(encoding='utf-8'))
            if response_path.exists()
            else _extract_json_payload(completed.stdout)
        )
    else:
        raw_output = _invoke_managed_runtime(config, request)

    print(json.dumps(adapter(raw_output, request, context)))
    return 0
