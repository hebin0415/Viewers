from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parents[1]
COMMON_DIR = CURRENT_DIR / 'common'
if str(COMMON_DIR) not in sys.path:
    sys.path.insert(0, str(COMMON_DIR))

from ohif_runtime_common import (  # noqa: E402
    fetch_series_to_directory,
    load_request,
    load_sorted_datasets,
    normalize_device_for_torch,
    representative_slice_image,
    write_response,
)
from ultralytics import YOLO  # noqa: E402
from ultralytics.utils.downloads import attempt_download_asset  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True)
    parser.add_argument('--response', required=True)
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--device', default='cpu')
    return parser.parse_args()


def ensure_weights(model_dir: Path) -> Path:
    weights_name = 'yolo26n.pt'
    weights_path = model_dir / weights_name
    weights_path.parent.mkdir(parents=True, exist_ok=True)
    attempt_download_asset(weights_path)
    return weights_path


def main() -> int:
    args = parse_args()
    request = load_request(args.request)
    model_dir = Path(args.model_dir).resolve()
    weights_path = ensure_weights(model_dir)

    with tempfile.TemporaryDirectory(prefix='ohif-yolo-') as temp_dir:
        dicom_dir = Path(temp_dir) / 'source-dicom'
        dicom_paths = fetch_series_to_directory(
            request.get('studyInstanceUID', ''),
            request.get('seriesInstanceUID', ''),
            dicom_dir,
        )
        datasets = load_sorted_datasets(dicom_paths)
        image, slice_index = representative_slice_image(datasets)

        model = YOLO(str(weights_path))
        result = model.predict(
            source=image,
            conf=float(request.get('options', {}).get('confidenceThreshold', 0.25)),
            verbose=False,
            device=normalize_device_for_torch(args.device),
        )[0]

        image_height, image_width = image.shape[:2]
        detections = []
        if result.boxes is not None:
            xyxy = result.boxes.xyxy.cpu().numpy()
            confidences = result.boxes.conf.cpu().numpy()
            class_ids = result.boxes.cls.cpu().numpy().astype(int)
            names = result.names
            for index, (box, confidence, class_id) in enumerate(zip(xyxy, confidences, class_ids, strict=False)):
                x1, y1, x2, y2 = box.tolist()
                label = names[int(class_id)] if not isinstance(names, dict) else names.get(int(class_id), str(class_id))
                detections.append(
                    {
                        'id': f'yolo-{index}',
                        'label': label,
                        'confidence': float(confidence),
                        'x': max(0.0, min(1.0, x1 / image_width)),
                        'y': max(0.0, min(1.0, y1 / image_height)),
                        'width': max(0.0, min(1.0, (x2 - x1) / image_width)),
                        'height': max(0.0, min(1.0, (y2 - y1) / image_height)),
                        'sliceIndex': slice_index,
                    }
                )

    payload = {
        'summary': f'Ultralytics YOLO produced {len(detections)} detection(s) on representative slice {slice_index}.',
        'detections': detections,
        'metadata': {
            'framework': 'Ultralytics YOLO',
            'weightsFile': str(weights_path),
            'sliceIndex': slice_index,
        },
    }
    write_response(args.response, payload)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
