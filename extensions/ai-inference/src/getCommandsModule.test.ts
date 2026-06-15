import {
  activateOverlayDisplaySet,
  getPrimaryNonOverlayDisplaySetForViewport,
  getViewportDisplaySetUIDsAfterBulkRemoval,
  getViewportDisplaySetUIDsAfterRemoval,
} from './utils/derivedDisplaySetActivation';

type MockDisplaySet = {
  displaySetInstanceUID: string;
  StudyInstanceUID?: string;
  SeriesInstanceUID?: string;
  referencedSeriesInstanceUID?: string;
  referencedDisplaySetInstanceUID?: string;
  isOverlayDisplaySet?: boolean;
  Modality?: string;
  SeriesDescription?: string;
  instances?: Array<{
    StudyInstanceUID?: string;
    SeriesInstanceUID?: string;
    SeriesDescription?: string;
  }>;
  madeInClient?: boolean;
};

const STUDY_INSTANCE_UID = '1.2.3.study';
const SOURCE_SERIES_INSTANCE_UID = '1.2.3.series.source';
const DERIVED_SERIES_INSTANCE_UID = '1.2.3.series.derived';
const SOURCE_DISPLAY_SET_UID = 'source-display-set';
const OVERLAY_DISPLAY_SET_UID = 'overlay-display-set';
const VIEWPORT_ID = 'default';

const createActivationDependencies = (modality: 'SEG' | 'RTSTRUCT') => {
  const displaySetsByUid = new Map<string, MockDisplaySet>();
  const sourceDisplaySet: MockDisplaySet = {
    displaySetInstanceUID: SOURCE_DISPLAY_SET_UID,
    StudyInstanceUID: STUDY_INSTANCE_UID,
    SeriesInstanceUID: SOURCE_SERIES_INSTANCE_UID,
    Modality: 'CT',
    instances: [
      {
        StudyInstanceUID: STUDY_INSTANCE_UID,
        SeriesInstanceUID: SOURCE_SERIES_INSTANCE_UID,
      },
    ],
  } as MockDisplaySet & { StudyInstanceUID: string };
  const overlayDisplaySet: MockDisplaySet = {
    displaySetInstanceUID: OVERLAY_DISPLAY_SET_UID,
    StudyInstanceUID: STUDY_INSTANCE_UID,
    SeriesInstanceUID: DERIVED_SERIES_INSTANCE_UID,
    referencedSeriesInstanceUID: SOURCE_SERIES_INSTANCE_UID,
    referencedDisplaySetInstanceUID: SOURCE_DISPLAY_SET_UID,
    isOverlayDisplaySet: true,
    Modality: modality,
    SeriesDescription: `AI | ${modality}`,
    instances: [
      {
        StudyInstanceUID: STUDY_INSTANCE_UID,
        SeriesInstanceUID: DERIVED_SERIES_INSTANCE_UID,
        SeriesDescription: `AI | ${modality}`,
      },
    ],
  } as MockDisplaySet & { StudyInstanceUID: string };

  displaySetsByUid.set(SOURCE_DISPLAY_SET_UID, sourceDisplaySet);
  displaySetsByUid.set(OVERLAY_DISPLAY_SET_UID, overlayDisplaySet);

  const viewports = new Map<string, { displaySetInstanceUIDs: string[] }>([
    [VIEWPORT_ID, { displaySetInstanceUIDs: [SOURCE_DISPLAY_SET_UID] }],
  ]);
  const viewportState = {
    activeViewportId: VIEWPORT_ID,
    isHangingProtocolLayout: false,
    viewports,
  };

  const viewportGridService = {
    getActiveViewportId: jest.fn(() => viewportState.activeViewportId),
    setActiveViewportId: jest.fn((viewportId: string) => {
      viewportState.activeViewportId = viewportId;
    }),
    getDisplaySetsUIDsForViewport: jest.fn(
      (viewportId: string) => viewportState.viewports.get(viewportId)?.displaySetInstanceUIDs ?? []
    ),
    getState: jest.fn(() => viewportState),
    setDisplaySetsForViewport: jest.fn(
      async ({
        viewportId,
        displaySetInstanceUIDs,
      }: {
        viewportId: string;
        displaySetInstanceUIDs: string[];
      }) => {
        viewportState.viewports.set(viewportId, {
          displaySetInstanceUIDs: [...displaySetInstanceUIDs],
        });
      }
    ),
  };

  const displaySetService = {
    getDisplaySetByUID: jest.fn((displaySetInstanceUID: string) =>
      displaySetsByUid.get(displaySetInstanceUID)
    ),
  };

  const commandsManager = {
    runCommand: jest.fn(
      async (
        commandName: string,
        options?: { viewportId?: string; displaySet?: MockDisplaySet }
      ) => {
        if (commandName === 'hydrateSecondaryDisplaySet' && options?.viewportId) {
          await viewportGridService.setDisplaySetsForViewport({
            viewportId: options.viewportId,
            displaySetInstanceUIDs: [SOURCE_DISPLAY_SET_UID],
          });
        }
      }
    ),
  };

  return {
    overlayDisplaySet,
    viewportGridService,
    displaySetService,
    commandsManager,
  };
};

describe('derived display set activation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test.each(['SEG', 'RTSTRUCT'] as const)(
    're-attaches %s overlay to the source viewport after hydration resets it',
    async modality => {
      const { overlayDisplaySet, viewportGridService, displaySetService, commandsManager } =
        createActivationDependencies(modality);

      await activateOverlayDisplaySet(overlayDisplaySet, VIEWPORT_ID, {
        viewportGridService,
        displaySetService,
        commandsManager,
      });

      expect(commandsManager.runCommand).toHaveBeenCalledWith('hydrateSecondaryDisplaySet', {
        displaySet: expect.objectContaining({
          displaySetInstanceUID: OVERLAY_DISPLAY_SET_UID,
          Modality: modality,
        }),
        viewportId: VIEWPORT_ID,
      });
      expect(
        viewportGridService.getState().viewports.get(VIEWPORT_ID)?.displaySetInstanceUIDs
      ).toEqual([SOURCE_DISPLAY_SET_UID, OVERLAY_DISPLAY_SET_UID]);
    }
  );

  test('falls back to the source display set when removing the only derived result from a viewport', () => {
    const { overlayDisplaySet, viewportGridService, displaySetService } =
      createActivationDependencies('SEG');

    viewportGridService.getState().viewports.set(VIEWPORT_ID, {
      displaySetInstanceUIDs: [OVERLAY_DISPLAY_SET_UID],
    });

    expect(
      getViewportDisplaySetUIDsAfterRemoval(
        displaySetService,
        viewportGridService,
        overlayDisplaySet,
        VIEWPORT_ID
      )
    ).toEqual([SOURCE_DISPLAY_SET_UID]);
  });

  test('filters removed and missing display sets out of the viewport list', () => {
    const { overlayDisplaySet, viewportGridService, displaySetService } =
      createActivationDependencies('RTSTRUCT');

    viewportGridService.getState().viewports.set(VIEWPORT_ID, {
      displaySetInstanceUIDs: [OVERLAY_DISPLAY_SET_UID, 'missing-display-set'],
    });

    expect(
      getViewportDisplaySetUIDsAfterRemoval(
        displaySetService,
        viewportGridService,
        overlayDisplaySet,
        VIEWPORT_ID
      )
    ).toEqual([SOURCE_DISPLAY_SET_UID]);
  });

  test('removes all display sets from the same AI series before falling back to the source display set', () => {
    const { viewportGridService, displaySetService } = createActivationDependencies('RTSTRUCT');
    const secondaryOverlayDisplaySet: MockDisplaySet = {
      displaySetInstanceUID: 'overlay-display-set-secondary',
      StudyInstanceUID: STUDY_INSTANCE_UID,
      SeriesInstanceUID: DERIVED_SERIES_INSTANCE_UID,
      referencedSeriesInstanceUID: SOURCE_SERIES_INSTANCE_UID,
      referencedDisplaySetInstanceUID: SOURCE_DISPLAY_SET_UID,
      isOverlayDisplaySet: true,
      Modality: 'RTSTRUCT',
      SeriesDescription: 'AI | RTSTRUCT secondary',
      instances: [
        {
          StudyInstanceUID: STUDY_INSTANCE_UID,
          SeriesInstanceUID: DERIVED_SERIES_INSTANCE_UID,
          SeriesDescription: 'AI | RTSTRUCT secondary',
        },
      ],
    };

    (displaySetService.getDisplaySetByUID as jest.Mock).mockImplementation(
      (displaySetInstanceUID: string) => {
        if (displaySetInstanceUID === secondaryOverlayDisplaySet.displaySetInstanceUID) {
          return secondaryOverlayDisplaySet;
        }

        return [SOURCE_DISPLAY_SET_UID, OVERLAY_DISPLAY_SET_UID].includes(displaySetInstanceUID)
          ? createActivationDependencies('RTSTRUCT').displaySetService.getDisplaySetByUID(
              displaySetInstanceUID
            )
          : undefined;
      }
    );

    viewportGridService.getState().viewports.set(VIEWPORT_ID, {
      displaySetInstanceUIDs: [
        OVERLAY_DISPLAY_SET_UID,
        secondaryOverlayDisplaySet.displaySetInstanceUID,
      ],
    });

    expect(
      getViewportDisplaySetUIDsAfterBulkRemoval(
        displaySetService,
        viewportGridService,
        {
          displaySetInstanceUIDs: [
            OVERLAY_DISPLAY_SET_UID,
            secondaryOverlayDisplaySet.displaySetInstanceUID,
          ],
          referencedDisplaySetInstanceUID: SOURCE_DISPLAY_SET_UID,
          referencedSeriesInstanceUID: SOURCE_SERIES_INSTANCE_UID,
          isOverlayDisplaySet: true,
        },
        VIEWPORT_ID
      )
    ).toEqual([SOURCE_DISPLAY_SET_UID]);
  });

  test('returns an empty viewport when bulk removal cannot resolve a source display set', () => {
    const { viewportGridService, displaySetService } = createActivationDependencies('SEG');

    viewportGridService.getState().viewports.set(VIEWPORT_ID, {
      displaySetInstanceUIDs: [OVERLAY_DISPLAY_SET_UID],
    });

    expect(
      getViewportDisplaySetUIDsAfterBulkRemoval(
        displaySetService,
        viewportGridService,
        {
          displaySetInstanceUIDs: [OVERLAY_DISPLAY_SET_UID],
          isOverlayDisplaySet: false,
        },
        VIEWPORT_ID
      )
    ).toEqual([]);
  });

  test('resolves the current source display set from the viewport for non-overlay derived-series activation', () => {
    const { viewportGridService, displaySetService } = createActivationDependencies('SEG');

    viewportGridService.getState().viewports.set(VIEWPORT_ID, {
      displaySetInstanceUIDs: [SOURCE_DISPLAY_SET_UID, OVERLAY_DISPLAY_SET_UID],
    });

    expect(
      getPrimaryNonOverlayDisplaySetForViewport(
        viewportGridService,
        displaySetService,
        VIEWPORT_ID,
        {
          excludeDisplaySetInstanceUID: OVERLAY_DISPLAY_SET_UID,
          excludeSeriesInstanceUID: DERIVED_SERIES_INSTANCE_UID,
        }
      )
    ).toEqual(
      expect.objectContaining({
        displaySetInstanceUID: SOURCE_DISPLAY_SET_UID,
        SeriesInstanceUID: SOURCE_SERIES_INSTANCE_UID,
      })
    );
  });
});
