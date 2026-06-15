from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


def _resolve_internal_command(family: str, model_dir: str) -> list[str]:
    family_key = family.upper()
    raw_command = os.environ.get(
        f'AI_INFERENCE_{family_key}_INTERNAL_COMMAND_JSON',
        os.environ.get('AI_INFERENCE_INTERNAL_COMMAND_JSON', ''),
    ).strip()
    if not raw_command:
        raise RuntimeError(
            f'Set AI_INFERENCE_{family_key}_INTERNAL_COMMAND_JSON inside the container image or '
            f'via docker environment to define the actual {family} inference command.'
        )

    if raw_command.startswith('['):
        parsed = json.loads(raw_command)
        if not isinstance(parsed, list) or not parsed:
            raise RuntimeError('Internal command must be a non-empty JSON array.')
        command = [str(item) for item in parsed]
    else:
        command = shlex.split(raw_command, posix=os.name != 'nt')

    device = os.environ.get('AI_INFERENCE_DEVICE', '')
    context = {
        'request_json': os.environ.get('AI_INFERENCE_REQUEST_JSON', ''),
        'response_json': os.environ.get('AI_INFERENCE_RESPONSE_JSON', ''),
        'model_dir': model_dir,
        'device': device,
        'inference_id': os.environ.get('AI_INFERENCE_INFERENCE_ID', ''),
        'model_name': os.environ.get('AI_INFERENCE_MODEL_NAME', ''),
        'task_type': os.environ.get('AI_INFERENCE_TASK_TYPE', ''),
        'study_uid': os.environ.get('AI_INFERENCE_STUDY_UID', ''),
        'series_uid': os.environ.get('AI_INFERENCE_SERIES_UID', ''),
    }
    return [item.format_map(context) for item in command]


def _extract_json_payload(stdout: str) -> dict:
    trimmed = stdout.strip()
    if not trimmed:
        raise RuntimeError('Internal command returned no JSON payload.')

    if trimmed.startswith('{'):
        return json.loads(trimmed)

    for line in reversed(trimmed.splitlines()):
        candidate = line.strip()
        if candidate.startswith('{') and candidate.endswith('}'):
            return json.loads(candidate)

    raise RuntimeError('Internal command stdout did not contain a JSON object payload.')


def run_family_adapter(family: str) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True)
    parser.add_argument('--response', required=True)
    parser.add_argument('--model-dir', required=True)
    args = parser.parse_args()

    request_path = Path(args.request).resolve()
    response_path = Path(args.response).resolve()
    model_dir = Path(args.model_dir).resolve()
    if not request_path.exists():
        raise RuntimeError(f'Request file not found: {request_path}')
    if not model_dir.exists():
        raise RuntimeError(f'Model directory not found: {model_dir}')

    request_payload = json.loads(request_path.read_text(encoding='utf-8'))
    os.environ['AI_INFERENCE_REQUEST_JSON'] = str(request_path)
    os.environ['AI_INFERENCE_RESPONSE_JSON'] = str(response_path)
    os.environ['AI_INFERENCE_MODEL_DIR'] = str(model_dir)
    os.environ['AI_INFERENCE_MODEL_NAME'] = request_payload.get('modelName', family)
    os.environ['AI_INFERENCE_TASK_TYPE'] = request_payload.get('taskType', '')
    os.environ['AI_INFERENCE_INFERENCE_ID'] = request_payload.get('inferenceId', '')
    os.environ['AI_INFERENCE_STUDY_UID'] = request_payload.get('studyInstanceUID', '') or ''
    os.environ['AI_INFERENCE_SERIES_UID'] = request_payload.get('seriesInstanceUID', '') or ''

    completed = subprocess.run(
        _resolve_internal_command(family, str(model_dir)),
        input=json.dumps(request_payload),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(
            f'{family} internal command exited with code {completed.returncode}: '
            f'{stderr or "unknown error"}'
        )

    payload = (
        json.loads(response_path.read_text(encoding='utf-8'))
        if response_path.exists()
        else _extract_json_payload(completed.stdout)
    )
    response_path.parent.mkdir(parents=True, exist_ok=True)
    response_path.write_text(json.dumps(payload), encoding='utf-8')
    sys.stdout.write(json.dumps(payload))
    return 0
