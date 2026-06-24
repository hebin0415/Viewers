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
        'id': raw_detection.get('id', f'yolo-detection-{index + 1}'),
        'label': raw_detection.get('label', 'Detection'),
        'confidence': raw_detection.get('confidence', 0.0),
        'x': bbox[0],
        'y': bbox[1],
        'width': bbox[2],
        'height': bbox[3],
        'sliceIndex': raw_detection.get('sliceIndex'),
        'anatomicalSite': raw_detection.get('anatomicalSite'),
        'lesionType': raw_detection.get('lesionType'),
        'sizeText': raw_detection.get('sizeText'),
        'assessment': raw_detection.get('assessment'),
        'annotationText': raw_detection.get('annotationText'),
    }


def _adapt_yolo_output(raw_output: dict, _request: dict, _context: dict[str, str]) -> dict:
    detections = [
        _normalize_detection(item, index) for index, item in enumerate(raw_output.get('detections', []))
    ]

    return {
        'status': 'completed',
        'resultFormat': raw_output.get('resultFormat', 'dicom-sr'),
        'payload': {
            'summary': raw_output.get('summary', 'YOLO wrapper completed detection'),
            'artifactUri': raw_output.get('artifactUri'),
            'visualizations': {
                'segmentation': None,
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
                family='yolo',
                raw_command_env_name='AI_INFERENCE_YOLO_WRAPPER_COMMAND',
            ),
            _adapt_yolo_output,
        )
    )
