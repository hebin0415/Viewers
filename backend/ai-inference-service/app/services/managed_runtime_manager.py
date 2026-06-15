from __future__ import annotations

import json
import os
import shlex
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.core.settings import settings


@dataclass(frozen=True)
class ManagedRuntimeDefinition:
    family: str
    host: str
    port: int
    command_env_name: str


_PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _runtime_command_env_name(family: str) -> str:
    return f'AI_INFERENCE_{family.upper()}_RUNTIME_COMMAND'


def _docker_template_ready(family: str) -> bool:
    family_key = family.upper()
    image_name = os.environ.get(f'AI_INFERENCE_{family_key}_IMAGE', '').strip()
    container_args = os.environ.get(f'AI_INFERENCE_{family_key}_CONTAINER_ARGS_JSON', '').strip()
    if not image_name or not container_args:
        return False

    model_dir = os.environ.get(f'AI_INFERENCE_{family_key}_MODEL_DIR', '').strip()
    if not model_dir:
        return (_PROJECT_ROOT / 'models' / family).exists()

    return Path(model_dir).expanduser().exists()


def _build_default_managed_command(definition: ManagedRuntimeDefinition) -> list[str]:
    if os.name == 'nt':
        script_path = _PROJECT_ROOT / 'scripts' / f'start-managed-{definition.family}.ps1'
        return [
            'powershell.exe',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            str(script_path),
            '-HostAddress',
            definition.host,
            '-Port',
            str(definition.port),
        ]

    return [
        sys.executable,
        '-m',
        'app.runtime_server',
        '--family',
        definition.family,
        '--host',
        definition.host,
        '--port',
        str(definition.port),
    ]


def _is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def _build_command(definition: ManagedRuntimeDefinition) -> list[str]:
    override = os.environ.get(definition.command_env_name, '').strip()
    context = {
        'family': definition.family,
        'host': definition.host,
        'port': str(definition.port),
    }
    if override:
        if override.startswith('['):
            return [str(item).format_map(context) for item in json.loads(override)]

        return shlex.split(override.format_map(context), posix=os.name != 'nt')

    return _build_default_managed_command(definition)


class ManagedRuntimeManager:
    def __init__(self) -> None:
        self._definitions = [
            ManagedRuntimeDefinition(
                family='nnunet',
                host=settings.managed_runtime_host,
                port=settings.nnunet_runtime_port,
                command_env_name='AI_INFERENCE_NNUNET_MANAGED_COMMAND',
            ),
            ManagedRuntimeDefinition(
                family='yolo',
                host=settings.managed_runtime_host,
                port=settings.yolo_runtime_port,
                command_env_name='AI_INFERENCE_YOLO_MANAGED_COMMAND',
            ),
            ManagedRuntimeDefinition(
                family='monai',
                host=settings.managed_runtime_host,
                port=settings.monai_runtime_port,
                command_env_name='AI_INFERENCE_MONAI_MANAGED_COMMAND',
            ),
        ]
        self._processes: dict[str, subprocess.Popen[str]] = {}

    def _should_start(self, definition: ManagedRuntimeDefinition) -> bool:
        override = os.environ.get(definition.command_env_name, '').strip()
        runtime_command = os.environ.get(_runtime_command_env_name(definition.family), '').strip()
        return bool(override or runtime_command or _docker_template_ready(definition.family))

    def start(self) -> None:
        if not settings.managed_runtimes_enabled:
            return

        for definition in self._definitions:
            if not self._should_start(definition):
                continue

            if _is_port_open(definition.host, definition.port):
                continue

            process = subprocess.Popen(
                _build_command(definition),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            self._processes[definition.family] = process
            self._wait_until_ready(definition, process)

    def stop(self) -> None:
        for process in self._processes.values():
            if process.poll() is None:
                process.terminate()

        deadline = time.monotonic() + 5
        for process in self._processes.values():
            if process.poll() is not None:
                continue
            remaining = max(deadline - time.monotonic(), 0)
            try:
                process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                process.kill()

        self._processes.clear()

    def _wait_until_ready(
        self,
        definition: ManagedRuntimeDefinition,
        process: subprocess.Popen[str],
    ) -> None:
        deadline = time.monotonic() + settings.managed_runtime_startup_timeout_seconds
        health_url = f'http://{definition.host}:{definition.port}/health'
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(
                    f'Managed runtime {definition.family} exited before becoming ready.'
                )

            try:
                response = httpx.get(health_url, timeout=1.0)
                if response.is_success:
                    return
            except httpx.HTTPError:
                pass

            time.sleep(0.25)

        raise RuntimeError(f'Managed runtime {definition.family} did not become ready in time.')


managed_runtime_manager = ManagedRuntimeManager()
