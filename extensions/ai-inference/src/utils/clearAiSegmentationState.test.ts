import {
  clearRelatedSegmentations,
  collectRelatedSegmentationIds,
} from './clearAiSegmentationState';

describe('clearAiSegmentationState', () => {
  test('collects segmentation ids directly from AI display sets and AI-labeled same-series segmentations', () => {
    const segmentationService = {
      getSegmentation: jest.fn((segmentationId: string) =>
        segmentationId === 'ai-display-set-1' ? { segmentationId } : undefined
      ),
      getSegmentations: jest.fn(() => [
        { segmentationId: 'ai-display-set-1' },
        { segmentationId: 'extra-ai-segmentation-for-same-series' },
        { segmentationId: 'source-display-set-segmentation' },
        { segmentationId: 'unrelated-segmentation' },
      ]),
    };

    const displaySetService = {
      getDisplaySetByUID: jest.fn((displaySetInstanceUID: string) => {
        if (displaySetInstanceUID === 'extra-ai-segmentation-for-same-series') {
          return {
            displaySetInstanceUID,
            SeriesInstanceUID: 'series-ai',
            SeriesDescription: 'AI | monai derived overlay',
          };
        }

        if (displaySetInstanceUID === 'source-display-set-segmentation') {
          return {
            displaySetInstanceUID,
            SeriesInstanceUID: 'series-ai',
            SeriesDescription: 'Original CT Series',
          };
        }

        if (displaySetInstanceUID === 'unrelated-segmentation') {
          return {
            displaySetInstanceUID,
            SeriesInstanceUID: 'series-other',
            SeriesDescription: 'AI | unrelated model',
          };
        }

        return undefined;
      }),
    };

    expect(
      collectRelatedSegmentationIds(
        [
          {
            displaySetInstanceUID: 'ai-display-set-1',
            SeriesInstanceUID: 'series-ai',
            SeriesDescription: 'AI | monai 20260615 SEG',
          },
        ],
        segmentationService,
        displaySetService
      )
    ).toEqual(['ai-display-set-1', 'extra-ai-segmentation-for-same-series']);
  });

  test('removes every related segmentation representation and segmentation state', () => {
    const segmentationService = {
      getSegmentation: jest.fn((segmentationId: string) => {
        return [
          'segmentation-a',
          'segmentation-b',
          'segmentation-c',
          'source-display-set',
        ].includes(segmentationId)
          ? { segmentationId }
          : undefined;
      }),
      getSegmentations: jest.fn(() => [
        { segmentationId: 'segmentation-a' },
        { segmentationId: 'segmentation-b' },
        { segmentationId: 'segmentation-c' },
        { segmentationId: 'source-display-set' },
      ]),
      getViewportIdsWithSegmentation: jest.fn((segmentationId: string) => {
        if (segmentationId === 'segmentation-a') {
          return ['viewport-1', 'viewport-2'];
        }

        if (segmentationId === 'segmentation-b') {
          return ['viewport-2'];
        }

        return [];
      }),
      removeRepresentationsFromViewport: jest.fn(),
      remove: jest.fn(),
    };

    const displaySetService = {
      getDisplaySetByUID: jest.fn((displaySetInstanceUID: string) => {
        if (displaySetInstanceUID === 'segmentation-a') {
          return {
            displaySetInstanceUID,
            SeriesInstanceUID: 'series-ai',
            SeriesDescription: 'AI | monai derived 1',
          };
        }

        if (displaySetInstanceUID === 'segmentation-b') {
          return {
            displaySetInstanceUID,
            SeriesInstanceUID: 'series-ai',
            SeriesDescription: 'AI | monai derived 2',
          };
        }

        if (displaySetInstanceUID === 'segmentation-c') {
          return {
            displaySetInstanceUID,
            SeriesInstanceUID: 'series-other',
            SeriesDescription: 'AI | other series',
          };
        }

        if (displaySetInstanceUID === 'source-display-set') {
          return {
            displaySetInstanceUID,
            SeriesInstanceUID: 'series-ai',
            SeriesDescription: 'Original CT Series',
          };
        }

        return undefined;
      }),
    };

    expect(
      clearRelatedSegmentations(
        [
          {
            displaySetInstanceUID: 'derived-ai-display-set',
            SeriesInstanceUID: 'series-ai',
            SeriesDescription: 'AI | monai current result',
          },
        ],
        segmentationService,
        displaySetService
      )
    ).toEqual(['segmentation-a', 'segmentation-b']);

    expect(segmentationService.removeRepresentationsFromViewport).toHaveBeenCalledTimes(3);
    expect(segmentationService.removeRepresentationsFromViewport).toHaveBeenNthCalledWith(
      1,
      'viewport-1',
      { segmentationId: 'segmentation-a' }
    );
    expect(segmentationService.removeRepresentationsFromViewport).toHaveBeenNthCalledWith(
      2,
      'viewport-2',
      { segmentationId: 'segmentation-a' }
    );
    expect(segmentationService.removeRepresentationsFromViewport).toHaveBeenNthCalledWith(
      3,
      'viewport-2',
      { segmentationId: 'segmentation-b' }
    );
    expect(segmentationService.remove).toHaveBeenCalledTimes(2);
    expect(segmentationService.remove).toHaveBeenNthCalledWith(1, 'segmentation-a');
    expect(segmentationService.remove).toHaveBeenNthCalledWith(2, 'segmentation-b');
  });
});
