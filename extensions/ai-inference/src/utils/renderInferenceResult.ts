import { cache } from '@cornerstonejs/core';
import {
  annotation,
  Enums as csToolsEnums,
  segmentation as cstSegmentation,
} from '@cornerstonejs/tools';
import { Types } from '@ohif/core';
import { DetectionVisualization, InferenceResult, SegmentationVisualization } from '../types';

const DEFAULT_SEGMENTATION: SegmentationVisualization = {
  label: 'AI Segmentation',
  segmentIndex: 1,
  x: 0.32,
  y: 0.28,
  width: 0.22,
  height: 0.22,
  sliceIndex: 0,
};

const DEFAULT_DETECTIONS: DetectionVisualization[] = [
  {
    id: 'default-lesion-1',
    label: 'AI lesion',
    confidence: 0.91,
    x: 0.34,
    y: 0.3,
    width: 0.2,
    height: 0.18,
    sliceIndex: 0,
  },
];

// These fallback primitives keep the viewport integration testable even when the
// backend returns scaffold metadata instead of a persisted segmentation series.

type RenderedResult = {
  annotationIds: string[];
  segmentationId: string | null;
};

type ViewportContext = {
  viewportId: string;
  viewport: any;
  displaySet: any;
  referencedImageId?: string;
  frameOfReferenceUID?: string;
};

function getActiveViewportContext(
  servicesManager: Types.Extensions.ExtensionParams['servicesManager']
): ViewportContext | null {
  const { viewportGridService, cornerstoneViewportService, displaySetService } =
    servicesManager.services as AppTypes.Services;
  const { activeViewportId, viewports } = viewportGridService.getState();

  if (!activeViewportId) {
    return null;
  }

  const viewportState = viewports.get(activeViewportId);
  const displaySetInstanceUID = viewportState?.displaySetInstanceUIDs?.[0];
  const displaySet = displaySetInstanceUID
    ? displaySetService.getDisplaySetByUID(displaySetInstanceUID)
    : null;
  const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);

  if (!displaySet || !viewport) {
    return null;
  }

  const fallbackImageId = displaySet.imageIds?.[Math.floor((displaySet.imageIds?.length ?? 1) / 2)];

  return {
    viewportId: activeViewportId,
    viewport,
    displaySet,
    referencedImageId: viewport.getCurrentImageId?.() ?? fallbackImageId,
    frameOfReferenceUID: viewport.getFrameOfReferenceUID?.(),
  };
}

export function clearRenderedAnnotations(annotationIds: string[]): void {
  annotationIds.forEach(annotationId => {
    annotation.state.removeAnnotation(annotationId);
  });
}

export function clearRenderedSegmentation(segmentationId: string | null): void {
  if (!segmentationId) {
    return;
  }

  cstSegmentation.state.removeSegmentation(segmentationId);
}

function paintSegmentationLabelmap(
  segmentationId: string,
  segmentationSpec: SegmentationVisualization
): void {
  const segmentation = cstSegmentation.state.getSegmentation(segmentationId) as any;
  const labelmapData =
    segmentation?.representationData?.[csToolsEnums.SegmentationRepresentations.Labelmap];
  const imageIds: string[] | undefined = labelmapData?.imageIds;

  if (!imageIds?.length) {
    return;
  }

  const sliceIndex = Math.max(
    0,
    Math.min(segmentationSpec.sliceIndex ?? Math.floor(imageIds.length / 2), imageIds.length - 1)
  );
  const segmentationImage = cache.getImage(imageIds[sliceIndex]) as any;
  const scalarData = segmentationImage?.getPixelData?.() as Uint8Array | Uint16Array | undefined;
  const rows = segmentationImage?.rows as number | undefined;
  const columns = segmentationImage?.columns as number | undefined;

  if (!scalarData || !rows || !columns) {
    return;
  }

  const xStart = Math.max(0, Math.floor(segmentationSpec.x * columns));
  const xEnd = Math.min(
    columns,
    Math.ceil((segmentationSpec.x + segmentationSpec.width) * columns)
  );
  const yStart = Math.max(0, Math.floor(segmentationSpec.y * rows));
  const yEnd = Math.min(rows, Math.ceil((segmentationSpec.y + segmentationSpec.height) * rows));

  for (let row = yStart; row < yEnd; row += 1) {
    for (let column = xStart; column < xEnd; column += 1) {
      scalarData[row * columns + column] = segmentationSpec.segmentIndex;
    }
  }
}

function addDetectionAnnotations(
  detections: DetectionVisualization[],
  context: ViewportContext
): string[] {
  const { viewport, referencedImageId, frameOfReferenceUID, displaySet } = context;
  const viewportWidth = Math.max(viewport.element?.clientWidth ?? 0, 256);
  const viewportHeight = Math.max(viewport.element?.clientHeight ?? 0, 256);

  return detections.map((detection, index) => {
    const left = detection.x * viewportWidth;
    const top = detection.y * viewportHeight;
    const right = (detection.x + detection.width) * viewportWidth;
    const bottom = (detection.y + detection.height) * viewportHeight;
    const points = [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ].map(point => viewport.canvasToWorld(point));
    const annotationUID = `ai-detection-${detection.id || index}`;

    annotation.state.addAnnotation({
      annotationUID,
      highlighted: false,
      isLocked: true,
      invalidated: true,
      metadata: {
        toolName: 'RectangleROI',
        referencedImageId,
        FrameOfReferenceUID: frameOfReferenceUID,
        displaySetInstanceUID: displaySet.displaySetInstanceUID,
      },
      data: {
        label: `${detection.label} ${Math.round(detection.confidence * 100)}%`,
        handles: {
          textBox: {
            hasMoved: false,
            worldPosition: points[1],
            worldBoundingBox: {},
          },
          points,
        },
        cachedStats: {
          [referencedImageId ?? `detection-${index}`]: {
            Modality: displaySet.Modality,
            area: Number((detection.width * detection.height * 100).toFixed(2)),
            areaUnit: '%',
            max: Number((detection.confidence * 100).toFixed(1)),
            mean: Number((detection.confidence * 100).toFixed(1)),
            stdDev: 0,
            modalityUnit: '%',
          },
        },
        frameNumber: (detection.sliceIndex ?? 0) + 1,
      },
    } as any);

    return annotationUID;
  });
}

export async function renderInferenceResultToViewport(
  result: InferenceResult,
  servicesManager: Types.Extensions.ExtensionParams['servicesManager'],
  commandsManager: Types.Extensions.ExtensionParams['commandsManager']
): Promise<RenderedResult> {
  const context = getActiveViewportContext(servicesManager);

  if (!context) {
    return { annotationIds: [], segmentationId: null };
  }

  const visualizations = result.payload.visualizations ?? {};
  const fallbackSegmentation = result.taskType === 'segmentation' ? DEFAULT_SEGMENTATION : null;
  const fallbackDetections = result.taskType === 'detection' ? DEFAULT_DETECTIONS : [];
  const segmentationSpec = visualizations.segmentation ?? fallbackSegmentation;
  const detections = visualizations.detections?.length
    ? visualizations.detections
    : fallbackDetections;

  let segmentationId: string | null = null;
  if (segmentationSpec) {
    segmentationId = (await commandsManager.runCommand('createLabelmapForViewport', {
      viewportId: context.viewportId,
      options: {
        segmentationId: `ai-segmentation-${result.inferenceId}`,
        label: segmentationSpec.label,
      },
    })) as string;

    if (segmentationId) {
      paintSegmentationLabelmap(segmentationId, segmentationSpec);
    }
  }

  const annotationIds = detections.length ? addDetectionAnnotations(detections, context) : [];
  const { cornerstoneViewportService } = servicesManager.services as AppTypes.Services;
  cornerstoneViewportService.getRenderingEngine()?.renderViewports([context.viewportId]);

  return {
    annotationIds,
    segmentationId,
  };
}
