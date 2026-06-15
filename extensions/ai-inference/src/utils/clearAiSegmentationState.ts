type SegmentationLike = {
  segmentationId?: string;
};

type DisplaySetLike = {
  displaySetInstanceUID?: string;
  SeriesInstanceUID?: string;
  SeriesDescription?: string;
  displaySetLabel?: string;
  label?: string;
  instances?: Array<{
    SeriesInstanceUID?: string;
    SeriesDescription?: string;
  }>;
};

type SegmentationServiceLike = {
  getSegmentation: (segmentationId: string) => SegmentationLike | undefined;
  getSegmentations: () => SegmentationLike[] | undefined;
  getViewportIdsWithSegmentation?: (segmentationId: string) => string[];
  removeRepresentationsFromViewport?: (
    viewportId: string,
    specifier?: { segmentationId?: string }
  ) => void;
  remove?: (segmentationId: string) => void;
};

type DisplaySetServiceLike = {
  getDisplaySetByUID: (displaySetInstanceUID: string) => DisplaySetLike | undefined;
};

const getDisplaySetSeriesInstanceUID = (displaySet: DisplaySetLike | undefined) =>
  displaySet?.SeriesInstanceUID ?? displaySet?.instances?.[0]?.SeriesInstanceUID ?? null;

const AI_RESULT_PREFIX = 'AI |';

const getDisplaySetLabel = (displaySet: DisplaySetLike | undefined) =>
  displaySet?.SeriesDescription ??
  displaySet?.displaySetLabel ??
  displaySet?.label ??
  displaySet?.instances?.[0]?.SeriesDescription ??
  '';

const isAiResultLabel = (value?: string | null) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .startsWith(AI_RESULT_PREFIX.toUpperCase());

export function collectRelatedSegmentationIds(
  displaySets: DisplaySetLike[],
  segmentationService: SegmentationServiceLike,
  displaySetService: DisplaySetServiceLike
): string[] {
  const relatedSegmentationIds = new Set<string>();
  const targetDisplaySetUIDs = new Set(
    displaySets
      .map(displaySet => displaySet?.displaySetInstanceUID)
      .filter((displaySetInstanceUID): displaySetInstanceUID is string => !!displaySetInstanceUID)
  );
  const targetSeriesInstanceUIDs = new Set(
    displaySets
      .map(displaySet => getDisplaySetSeriesInstanceUID(displaySet))
      .filter((seriesInstanceUID): seriesInstanceUID is string => !!seriesInstanceUID)
  );

  targetDisplaySetUIDs.forEach(displaySetInstanceUID => {
    if (segmentationService.getSegmentation(displaySetInstanceUID)) {
      relatedSegmentationIds.add(displaySetInstanceUID);
    }
  });

  const segmentations = segmentationService.getSegmentations?.() ?? [];

  segmentations.forEach(segmentation => {
    const segmentationId = segmentation?.segmentationId;

    if (!segmentationId || relatedSegmentationIds.has(segmentationId)) {
      return;
    }

    if (targetDisplaySetUIDs.has(segmentationId)) {
      relatedSegmentationIds.add(segmentationId);
      return;
    }

    const relatedDisplaySet = displaySetService.getDisplaySetByUID(segmentationId);
    const relatedSeriesInstanceUID = getDisplaySetSeriesInstanceUID(relatedDisplaySet);

    if (
      relatedSeriesInstanceUID &&
      targetSeriesInstanceUIDs.has(relatedSeriesInstanceUID) &&
      isAiResultLabel(getDisplaySetLabel(relatedDisplaySet))
    ) {
      relatedSegmentationIds.add(segmentationId);
    }
  });

  return [...relatedSegmentationIds];
}

export function clearRelatedSegmentations(
  displaySets: DisplaySetLike[],
  segmentationService: SegmentationServiceLike,
  displaySetService: DisplaySetServiceLike
): string[] {
  const relatedSegmentationIds = collectRelatedSegmentationIds(
    displaySets,
    segmentationService,
    displaySetService
  );

  relatedSegmentationIds.forEach(segmentationId => {
    const viewportIds = segmentationService.getViewportIdsWithSegmentation?.(segmentationId) ?? [];

    viewportIds.forEach(viewportId => {
      segmentationService.removeRepresentationsFromViewport?.(viewportId, {
        segmentationId,
      });
    });

    segmentationService.remove?.(segmentationId);
  });

  return relatedSegmentationIds;
}
