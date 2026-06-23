from __future__ import annotations

from common import WrapperConfig, run_wrapper


def _normalize_detection(raw_detection: dict, index: int) -> dict:
    bbox = raw_detection.get('bbox') or [
        raw_detection.get('x', 0.0),
        raw_detection.get('y', 0.0),
        raw_detection.get('width', 0.0),
        raw_detection.get('height', 0.0),
    ]

    return {
        'id': raw_detection.get('id', f'monai-detection-{index + 1}'),
        'label': raw_detection.get('label', 'Detection'),
        'confidence': raw_detection.get('confidence', 0.0),
        'x': bbox[0],
        'y': bbox[1],
        'width': bbox[2],
        'height': bbox[3],
        'sliceIndex': raw_detection.get('sliceIndex'),
    }


def _adapt_monai_output(raw_output: dict, request: dict, _context: dict[str, str]) -> dict:
    task_type = request['taskType']
    detections = [
        _normalize_detection(item, index) for index, item in enumerate(raw_output.get('detections', []))
    ]
    summary = raw_output.get('summary')
    if not summary and task_type == 'classification' and raw_output.get('classification'):
        classification = raw_output['classification']
        summary = (
            f"MONAI classification: {classification.get('label', 'unknown')} "
            f"({round(classification.get('confidence', 0.0) * 100, 1)}%)"
        )

    return {
        'status': 'completed',
        'resultFormat': raw_output.get(
            'resultFormat',
            'dicom-seg' if task_type == 'segmentation' else 'rtstruct' if task_type == 'detection' else 'dicom-sr',
        ),
        'payload': {
            'summary': summary or f'MONAI wrapper completed {task_type}',
            'artifactUri': raw_output.get('artifactUri'),
            'visualizations': {
                'segmentation': raw_output.get('segmentation'),
                'detections': detections,
            },
            'storage': {
                'mode': 'derived-series',
            },
        },
        'artifacts': {
            'dicomFiles': raw_output.get('dicomFiles', []),
        },
    }


if __name__ == '__main__':
    raise SystemExit(
        run_wrapper(
            WrapperConfig(
                family='monai',
                raw_command_env_name='AI_INFERENCE_MONAI_WRAPPER_COMMAND',
            ),
            _adapt_monai_output,
        )
    )
