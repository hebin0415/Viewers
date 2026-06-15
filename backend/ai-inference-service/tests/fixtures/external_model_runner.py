import json
import sys


def build_response(payload: dict) -> dict:
    model_name = payload['modelName']
    task_type = payload['taskType']
    inference_id = payload['inferenceId']

    if model_name == 'nnunet':
        return {
            'summary': 'nnU-Net external runner completed segmentation',
            'segmentation': {
                'label': 'nnU-Net lesion',
                'segmentIndex': 1,
                'x': 0.31,
                'y': 0.27,
                'width': 0.24,
                'height': 0.24,
                'sliceIndex': 0,
            },
        }

    if model_name == 'yolo':
        return {
            'summary': 'YOLO external runner completed detection',
            'artifactUri': f'file:///tmp/{inference_id}/yolo.json',
            'detections': [
                {
                    'id': 'yolo-lesion-1',
                    'label': 'Candidate lesion',
                    'confidence': 0.92,
                    'bbox': [0.34, 0.31, 0.2, 0.18],
                    'sliceIndex': 0,
                },
                {
                    'id': 'yolo-lesion-2',
                    'label': 'Secondary focus',
                    'confidence': 0.78,
                    'bbox': [0.56, 0.42, 0.12, 0.14],
                    'sliceIndex': 0,
                },
            ],
        }

    if model_name == 'monai' and task_type == 'classification':
        return {
            'summary': 'MONAI external runner completed classification',
            'artifactUri': f'file:///tmp/{inference_id}/monai-classification.json',
            'classification': {
                'label': 'positive',
                'confidence': 0.87,
            },
        }

    if model_name == 'monai' and task_type == 'segmentation':
        return {
            'summary': 'MONAI external runner completed segmentation',
            'segmentation': {
                'label': 'MONAI segmentation',
                'segmentIndex': 1,
                'x': 0.29,
                'y': 0.26,
                'width': 0.26,
                'height': 0.22,
                'sliceIndex': 0,
            },
        }

    return {
        'summary': 'MONAI external runner completed detection',
        'artifactUri': f'file:///tmp/{inference_id}/monai-detection.json',
        'detections': [
            {
                'id': 'monai-detection-1',
                'label': 'MONAI finding',
                'confidence': 0.81,
                'bbox': [0.38, 0.36, 0.18, 0.16],
                'sliceIndex': 0,
            }
        ],
    }


def main() -> int:
    payload = json.loads(sys.stdin.read())
    sys.stdout.write(json.dumps(build_response(payload)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
