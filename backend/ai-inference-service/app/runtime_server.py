from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import tempfile
from pathlib import Path
import re

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


class RuntimeRequest(BaseModel):
    jobId: str
    inferenceId: str
    modelName: str
    taskType: str
    studyInstanceUID: str | None = None
    seriesInstanceUID: str | None = None
    options: dict = Field(default_factory=dict)


def _runtime_command_env_name(family: str) -> str:
    return f'AI_INFERENCE_{family.upper()}_RUNTIME_COMMAND'


def _to_docker_path(path_value: str) -> str:
    normalized = Path(path_value).resolve().as_posix()
    if len(normalized) >= 3 and normalized[0] == '/' and normalized[2] == ':':
        return normalized[1].upper() + normalized[2:]

    return normalized


def _resolve_command(raw_command: str, context: dict[str, str]) -> list[str]:
    if raw_command.startswith('['):
        parsed = json.loads(raw_command)
        if not isinstance(parsed, list) or not parsed:
            raise RuntimeError('Runtime command must be a non-empty JSON command array')

        return [_format_runtime_arg(str(item), context) for item in parsed]

    return shlex.split(_format_known_placeholders(raw_command, context), posix=os.name != 'nt')


def _format_known_placeholders(template: str, context: dict[str, str]) -> str:
    pattern = re.compile(r'\{([a-zA-Z_][a-zA-Z0-9_]*)\}')
    return pattern.sub(lambda match: context.get(match.group(1), match.group(0)), template)


def _format_runtime_arg(template: str, context: dict[str, str]) -> str:
    if re.match(r'^AI_INFERENCE(?:_[A-Z]+)?_INTERNAL_COMMAND_JSON=', template):
        return template

    return _format_known_placeholders(template, context)


def _extract_json_payload(stdout: str) -> dict:
    trimmed = stdout.strip()
    if not trimmed:
        raise RuntimeError('Managed runtime command did not return any JSON payload')

    if trimmed.startswith('{'):
        return json.loads(trimmed)

    for line in reversed(trimmed.splitlines()):
        candidate = line.strip()
        if candidate.startswith('{') and candidate.endswith('}'):
            return json.loads(candidate)

    raise RuntimeError('Managed runtime command stdout did not contain a JSON object payload')


def _resolve_runtime_work_path(path_value: str, work_dir: str) -> str:
    normalized = path_value.replace('\\', '/').strip()
    lowered = normalized.lower()
    prefixes = ('/runtime/work/', 'c:/runtime/work/')

    for prefix in prefixes:
        if lowered.startswith(prefix):
            relative_parts = [part for part in normalized[len(prefix) :].split('/') if part]
            return str(Path(work_dir, *relative_parts))

    return path_value


def _materialize_runtime_output_paths(payload: dict, work_dir: str) -> dict:
    dicom_files = payload.get('dicomFiles')
    if not isinstance(dicom_files, list):
        return payload

    payload = dict(payload)
    payload['dicomFiles'] = [
        _resolve_runtime_work_path(str(file_path), work_dir) for file_path in dicom_files
    ]
    return payload


def _run_runtime_command(family: str, request: RuntimeRequest) -> dict:
    runtime_command = os.environ.get(_runtime_command_env_name(family), '').strip()
    if not runtime_command:
        raise RuntimeError(
            f'Set {_runtime_command_env_name(family)} to the raw model container or runtime command, '
            f'or override AI_INFERENCE_{family.upper()}_MANAGED_COMMAND with a dedicated service startup command.'
        )

    work_dir = Path(tempfile.mkdtemp(prefix=f'ai-{family}-runtime-')).resolve()
    request_path = work_dir / 'request.json'
    response_path = work_dir / 'response.json'
    request_payload = request.model_dump(mode='json')
    request_path.write_text(json.dumps(request_payload), encoding='utf-8')

    context = {
        'family': family,
        'work_dir': str(work_dir),
        'work_dir_docker': _to_docker_path(str(work_dir)),
        'request_json': str(request_path),
        'request_json_docker': _to_docker_path(str(request_path)),
        'response_json': str(response_path),
        'response_json_docker': _to_docker_path(str(response_path)),
        'inference_id': request.inferenceId,
        'study_uid': request.studyInstanceUID or '',
        'series_uid': request.seriesInstanceUID or '',
        'task_type': request.taskType,
        'model_name': request.modelName,
    }

    completed = subprocess.run(
        _resolve_command(runtime_command, context),
        input=json.dumps(request_payload),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(
            f'{family} managed runtime command exited with code {completed.returncode}: '
            f'{stderr or "unknown error"}'
        )

    if response_path.exists():
        raw_output = json.loads(response_path.read_text(encoding='utf-8'))
    else:
        raw_output = _extract_json_payload(completed.stdout)

    return _materialize_runtime_output_paths(raw_output, context['work_dir'])


def create_app(family: str) -> FastAPI:
    app = FastAPI(title=f'AI {family} managed runtime')

    @app.get('/health')
    def health() -> dict:
        return {
            'status': 'ok',
            'family': family,
            'configured': bool(os.environ.get(_runtime_command_env_name(family), '').strip()),
        }

    @app.post('/infer')
    def infer(request: RuntimeRequest) -> dict:
        try:
            return _run_runtime_command(family, request)
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    return app


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--family', required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', required=True, type=int)
    args = parser.parse_args()

    uvicorn.run(create_app(args.family), host=args.host, port=args.port, log_level='warning')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
