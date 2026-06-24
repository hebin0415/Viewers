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
    sampled_slice_images,
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


def describe_anatomical_site(x: float, y: float, width: float, height: float) -> str:
    center_x = x + width / 2.0
    center_y = y + height / 2.0

    horizontal = 'left' if center_x < 0.33 else 'right' if center_x > 0.67 else 'central'
    vertical = 'upper' if center_y < 0.33 else 'lower' if center_y > 0.67 else 'mid'
    return f'{horizontal}-{vertical} field'


def describe_assessment(confidence: float) -> str:
    if confidence >= 0.75:
        return 'high suspicion'
    if confidence >= 0.4:
        return 'moderate suspicion'
    return 'low suspicion'


def describe_size_text(width: float, height: float, image_width: int, image_height: int) -> str:
    width_px = max(1, round(width * image_width))
    height_px = max(1, round(height * image_height))
    return f'{width_px}x{height_px} px ({width * 100:.1f}% x {height * 100:.1f}%)'


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
        options = request.get('options', {})
        sampled_slices = sampled_slice_images(
            datasets,
            sparse_sample_count=int(options.get('sparseSampleCount', 1) or 1),
            full_series_review=bool(options.get('fullSeriesReview', False)),
        )

        model = YOLO(str(weights_path))
        detections = []
        reviewed_slice_indexes = []
        detection_index = 0
        for image, slice_index in sampled_slices:
            reviewed_slice_indexes.append(slice_index)
            result = model.predict(
                source=image,
                conf=float(options.get('confidenceThreshold', 0.25)),
                verbose=False,
                device=normalize_device_for_torch(args.device),
            )[0]

            image_height, image_width = image.shape[:2]
            if result.boxes is None:
                continue

            xyxy = result.boxes.xyxy.cpu().numpy()
            confidences = result.boxes.conf.cpu().numpy()
            class_ids = result.boxes.cls.cpu().numpy().astype(int)
            names = result.names
            for box, confidence, class_id in zip(xyxy, confidences, class_ids, strict=False):
                x1, y1, x2, y2 = box.tolist()
                label = names[int(class_id)] if not isinstance(names, dict) else names.get(int(class_id), str(class_id))
                normalized_x = max(0.0, min(1.0, x1 / image_width))
                normalized_y = max(0.0, min(1.0, y1 / image_height))
                normalized_width = max(0.0, min(1.0, (x2 - x1) / image_width))
                normalized_height = max(0.0, min(1.0, (y2 - y1) / image_height))
                anatomical_site = describe_anatomical_site(
                    normalized_x,
                    normalized_y,
                    normalized_width,
                    normalized_height,
                )
                lesion_type = str(label)
                size_text = describe_size_text(
                    normalized_width,
                    normalized_height,
                    image_width,
                    image_height,
                )
                assessment = describe_assessment(float(confidence))
                detections.append(
                    {
                        'id': f'yolo-{detection_index}',
                        'label': label,
                        'confidence': float(confidence),
                        'x': normalized_x,
                        'y': normalized_y,
                        'width': normalized_width,
                        'height': normalized_height,
                        'sliceIndex': slice_index,
                        'anatomicalSite': anatomical_site,
                        'lesionType': lesion_type,
                        'sizeText': size_text,
                        'assessment': assessment,
                        'annotationText': (
                            f'Site: {anatomical_site}; Type: {lesion_type}; '
                            f'Size: {size_text}; Assessment: {assessment}; '
                            f'Confidence: {float(confidence) * 100:.1f}%'
                        ),
                    }
                )
                detection_index += 1

    positive_slice_count = len({detection['sliceIndex'] for detection in detections})
    reviewed_slice_count = len(reviewed_slice_indexes)
    highest_confidence = max((detection['confidence'] for detection in detections), default=0.0)

    payload = {
        'summary': (
            f'Ultralytics YOLO produced {len(detections)} detection(s) across '
            f'{positive_slice_count or 0} positive slice(s) out of {reviewed_slice_count} reviewed slice(s); '
            f'highest confidence {highest_confidence:.1%}.'
        ),
        'detections': detections,
        'metadata': {
            'framework': 'Ultralytics YOLO',
            'weightsFile': str(weights_path),
            'reviewedSliceIndexes': reviewed_slice_indexes,
        },
    }
    write_response(args.response, payload)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
