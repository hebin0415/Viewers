from __future__ import annotations

from common import WrapperConfig, resolve_runtime_work_path, run_wrapper


def _adapt_nnunet_output(raw_output: dict, _request: dict, context: dict[str, str]) -> dict:
    dicom_files = [
        resolve_runtime_work_path(file_path, context) for file_path in raw_output.get('dicomFiles', [])
    ]

    return {
        'status': 'completed',
        'resultFormat': raw_output.get('resultFormat', 'dicom-seg'),
        'payload': {
            'summary': raw_output.get('summary', 'nnU-Net wrapper completed segmentation'),
            'artifactUri': raw_output.get('artifactUri'),
            'visualizations': {
                'segmentation': raw_output.get('segmentation'),
                'detections': [],
            },
            'storage': {
                'mode': 'derived-series',
            },
        },
        'artifacts': {
            'dicomFiles': dicom_files,
        },
    }


if __name__ == '__main__':
    raise SystemExit(
        run_wrapper(
            WrapperConfig(
                family='nnunet',
                raw_command_env_name='AI_INFERENCE_NNUNET_WRAPPER_COMMAND',
            ),
            _adapt_nnunet_output,
        )
    )
