from pathlib import Path
import sys

import numpy as np
import pytest
from pydicom.dataset import Dataset

from app.schemas.api import (
    InferencePayload,
    InferenceVisualizations,
    ResultStorageInfo,
    SegmentationVisualization,
)
from app.services.derived_dicom import _rasterize_segmentation


COMMON_DIR = Path(__file__).resolve().parents[1] / 'runtime-images' / 'common'
if str(COMMON_DIR) not in sys.path:
    sys.path.insert(0, str(COMMON_DIR))

from ohif_runtime_common import compute_mask_visualization  # noqa: E402


def _build_source_images(count: int, rows: int = 64, columns: int = 64) -> list[Dataset]:
    images: list[Dataset] = []
    for index in range(count):
        dataset = Dataset()
        dataset.Rows = rows
        dataset.Columns = columns
        dataset.InstanceNumber = index + 1
        images.append(dataset)
    return images


def test_rasterize_segmentation_matches_source_plane_count_when_slice_index_exceeds_range() -> None:
    payload = InferencePayload(
        summary='MONAI segmentation',
        visualizations=InferenceVisualizations(
            segmentation=SegmentationVisualization(
                label='spleen',
                segmentIndex=1,
                x=0.25,
                y=0.25,
                width=0.25,
                height=0.25,
                sliceIndex=106,
            )
        ),
        storage=ResultStorageInfo(mode='derived-series'),
    )

    mask = _rasterize_segmentation(payload, _build_source_images(10))

    assert mask.shape == (10, 64, 64)
    assert mask[-1].any()
    assert mask[:-1].sum() == 0


def test_compute_mask_visualization_uses_shortest_axis_as_slice_axis() -> None:
    mask = np.zeros((64, 64, 10), dtype=np.uint8)
    mask[20:40, 10:30, 6] = 1

    visualization = compute_mask_visualization(mask)

    assert visualization is not None
    assert visualization['sliceIndex'] == 6
    assert visualization['x'] == pytest.approx(10 / 64)
    assert visualization['y'] == pytest.approx(20 / 64)
    assert visualization['width'] == pytest.approx(20 / 64)
    assert visualization['height'] == pytest.approx(20 / 64)
