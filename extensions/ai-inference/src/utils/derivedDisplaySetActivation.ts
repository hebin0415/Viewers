type ViewportState = {
  displaySetInstanceUIDs?: string[];
};

type DerivedDisplaySet = {
  displaySetInstanceUID: string;
  SeriesInstanceUID?: string;
  referencedSeriesInstanceUID?: string;
  referencedDisplaySetInstanceUID?: string;
  isOverlayDisplaySet?: boolean;
  Modality?: string;
  instances?: Array<{ SeriesInstanceUID?: string }>;
};

type ViewportGridServiceLike = {
  getDisplaySetsUIDsForViewport?: (viewportId: string) => string[];
  getState: () => {
    viewports: Map<string, ViewportState>;
  };
  setActiveViewportId?: (viewportId: string) => void;
  setDisplaySetsForViewport: (options: {
    viewportId: string;
    displaySetInstanceUIDs: string[];
  }) => Promise<unknown> | unknown;
};

type DisplaySetServiceLike = {
  getDisplaySetByUID: (displaySetInstanceUID: string) => DerivedDisplaySet | undefined;
};

type CommandsManagerLike = {
  runCommand: (commandName: string, options: unknown) => Promise<unknown> | unknown;
};

type ActivationDependencies = {
  viewportGridService: ViewportGridServiceLike;
  displaySetService: DisplaySetServiceLike;
  commandsManager: CommandsManagerLike;
};

const getViewportDisplaySets = (
  viewportGridService: ViewportGridServiceLike,
  displaySetService: DisplaySetServiceLike,
  viewportId: string
) => {
  const displaySetInstanceUIDs =
    viewportGridService.getDisplaySetsUIDsForViewport?.(viewportId) ??
    viewportGridService.getState().viewports.get(viewportId)?.displaySetInstanceUIDs ??
    [];

  return displaySetInstanceUIDs
    .map(displaySetInstanceUID => displaySetService.getDisplaySetByUID(displaySetInstanceUID))
    .filter(Boolean) as DerivedDisplaySet[];
};

export const getPrimaryNonOverlayDisplaySetForViewport = (
  viewportGridService: ViewportGridServiceLike,
  displaySetService: DisplaySetServiceLike,
  viewportId: string,
  options?: {
    excludeDisplaySetInstanceUID?: string;
    excludeSeriesInstanceUID?: string;
  }
) => {
  return (
    getViewportDisplaySets(viewportGridService, displaySetService, viewportId).find(displaySet => {
      if (displaySet.isOverlayDisplaySet) {
        return false;
      }

      if (
        options?.excludeDisplaySetInstanceUID &&
        displaySet.displaySetInstanceUID === options.excludeDisplaySetInstanceUID
      ) {
        return false;
      }

      const seriesInstanceUID =
        displaySet.SeriesInstanceUID ?? displaySet.instances?.[0]?.SeriesInstanceUID;

      if (
        options?.excludeSeriesInstanceUID &&
        seriesInstanceUID === options.excludeSeriesInstanceUID
      ) {
        return false;
      }

      return true;
    }) ?? null
  );
};

export const resolveReferencedDisplaySetForDerivedResult = (
  displaySetService: DisplaySetServiceLike,
  viewportGridService: ViewportGridServiceLike,
  targetDisplaySet: Pick<
    DerivedDisplaySet,
    'referencedDisplaySetInstanceUID' | 'referencedSeriesInstanceUID' | 'isOverlayDisplaySet'
  >,
  viewportId: string
) => {
  if (targetDisplaySet.referencedDisplaySetInstanceUID) {
    const referencedDisplaySet = displaySetService.getDisplaySetByUID(
      targetDisplaySet.referencedDisplaySetInstanceUID
    );

    if (referencedDisplaySet) {
      return referencedDisplaySet;
    }
  }

  const viewportDisplaySets = getViewportDisplaySets(
    viewportGridService,
    displaySetService,
    viewportId
  );
  const sourceDisplaySet = viewportDisplaySets.find(displaySet => {
    const seriesInstanceUID =
      displaySet.SeriesInstanceUID ?? displaySet.instances?.[0]?.SeriesInstanceUID;

    return (
      !displaySet.isOverlayDisplaySet &&
      !!seriesInstanceUID &&
      !!targetDisplaySet.referencedSeriesInstanceUID &&
      seriesInstanceUID === targetDisplaySet.referencedSeriesInstanceUID
    );
  });

  if (sourceDisplaySet) {
    return sourceDisplaySet;
  }

  return getPrimaryNonOverlayDisplaySetForViewport(
    viewportGridService,
    displaySetService,
    viewportId
  );
};

export const ensureOverlayDisplaySetAttachedToViewport = (
  viewportGridService: ViewportGridServiceLike,
  viewportId: string,
  sourceDisplaySetInstanceUID: string,
  overlayDisplaySetInstanceUID: string
) => {
  const currentViewport = viewportGridService.getState().viewports.get(viewportId);
  const existingDisplaySetInstanceUIDs = currentViewport?.displaySetInstanceUIDs ?? [];
  const nextDisplaySetInstanceUIDs = [
    sourceDisplaySetInstanceUID,
    ...existingDisplaySetInstanceUIDs.filter(uid => uid !== sourceDisplaySetInstanceUID),
  ];

  if (!nextDisplaySetInstanceUIDs.includes(overlayDisplaySetInstanceUID)) {
    nextDisplaySetInstanceUIDs.push(overlayDisplaySetInstanceUID);
  }

  return viewportGridService.setDisplaySetsForViewport({
    viewportId,
    displaySetInstanceUIDs: nextDisplaySetInstanceUIDs,
  });
};

export const getViewportDisplaySetUIDsAfterRemoval = (
  displaySetService: DisplaySetServiceLike,
  viewportGridService: ViewportGridServiceLike,
  targetDisplaySet: Pick<
    DerivedDisplaySet,
    | 'displaySetInstanceUID'
    | 'referencedDisplaySetInstanceUID'
    | 'referencedSeriesInstanceUID'
    | 'isOverlayDisplaySet'
  >,
  viewportId: string
) => {
  const viewportDisplaySetUIDs =
    viewportGridService.getDisplaySetsUIDsForViewport?.(viewportId) ??
    viewportGridService.getState().viewports.get(viewportId)?.displaySetInstanceUIDs ??
    [];

  const remainingDisplaySetUIDs = viewportDisplaySetUIDs.filter(
    displaySetInstanceUID =>
      displaySetInstanceUID !== targetDisplaySet.displaySetInstanceUID &&
      !!displaySetService.getDisplaySetByUID(displaySetInstanceUID)
  );

  if (remainingDisplaySetUIDs.length) {
    return remainingDisplaySetUIDs;
  }

  const referencedDisplaySet = resolveReferencedDisplaySetForDerivedResult(
    displaySetService,
    viewportGridService,
    targetDisplaySet,
    viewportId
  );

  if (
    referencedDisplaySet?.displaySetInstanceUID &&
    referencedDisplaySet.displaySetInstanceUID !== targetDisplaySet.displaySetInstanceUID
  ) {
    return [referencedDisplaySet.displaySetInstanceUID];
  }

  return [];
};

export const getViewportDisplaySetUIDsAfterBulkRemoval = (
  displaySetService: DisplaySetServiceLike,
  viewportGridService: ViewportGridServiceLike,
  targetDisplaySet: Pick<
    DerivedDisplaySet,
    'referencedDisplaySetInstanceUID' | 'referencedSeriesInstanceUID' | 'isOverlayDisplaySet'
  > & {
    displaySetInstanceUIDs: string[];
  },
  viewportId: string
) => {
  const displaySetUIDsToRemove = new Set(targetDisplaySet.displaySetInstanceUIDs);
  const viewportDisplaySetUIDs =
    viewportGridService.getDisplaySetsUIDsForViewport?.(viewportId) ??
    viewportGridService.getState().viewports.get(viewportId)?.displaySetInstanceUIDs ??
    [];

  const remainingDisplaySetUIDs = viewportDisplaySetUIDs.filter(
    displaySetInstanceUID =>
      !displaySetUIDsToRemove.has(displaySetInstanceUID) &&
      !!displaySetService.getDisplaySetByUID(displaySetInstanceUID)
  );

  if (remainingDisplaySetUIDs.length) {
    return remainingDisplaySetUIDs;
  }

  const referencedDisplaySet = resolveReferencedDisplaySetForDerivedResult(
    displaySetService,
    viewportGridService,
    {
      referencedDisplaySetInstanceUID: targetDisplaySet.referencedDisplaySetInstanceUID,
      referencedSeriesInstanceUID: targetDisplaySet.referencedSeriesInstanceUID,
      isOverlayDisplaySet: targetDisplaySet.isOverlayDisplaySet,
    },
    viewportId
  );

  if (
    referencedDisplaySet?.displaySetInstanceUID &&
    !displaySetUIDsToRemove.has(referencedDisplaySet.displaySetInstanceUID)
  ) {
    return [referencedDisplaySet.displaySetInstanceUID];
  }

  return [];
};

export const activateOverlayDisplaySet = async (
  targetDisplaySet: DerivedDisplaySet,
  viewportId: string,
  { viewportGridService, displaySetService, commandsManager }: ActivationDependencies
) => {
  viewportGridService.setActiveViewportId?.(viewportId);

  const referencedDisplaySet = resolveReferencedDisplaySetForDerivedResult(
    displaySetService,
    viewportGridService,
    targetDisplaySet,
    viewportId
  );

  if (referencedDisplaySet?.displaySetInstanceUID) {
    targetDisplaySet.referencedDisplaySetInstanceUID = referencedDisplaySet.displaySetInstanceUID;

    const viewportDisplaySetUIDs =
      viewportGridService.getDisplaySetsUIDsForViewport?.(viewportId) ??
      viewportGridService.getState().viewports.get(viewportId)?.displaySetInstanceUIDs ??
      [];

    if (!viewportDisplaySetUIDs.includes(referencedDisplaySet.displaySetInstanceUID)) {
      await viewportGridService.setDisplaySetsForViewport({
        viewportId,
        displaySetInstanceUIDs: [referencedDisplaySet.displaySetInstanceUID],
      });
    }

    await ensureOverlayDisplaySetAttachedToViewport(
      viewportGridService,
      viewportId,
      referencedDisplaySet.displaySetInstanceUID,
      targetDisplaySet.displaySetInstanceUID
    );
  }

  await commandsManager.runCommand('hydrateSecondaryDisplaySet', {
    displaySet: targetDisplaySet,
    viewportId,
  });

  const referencedDisplaySetAfterHydrate = resolveReferencedDisplaySetForDerivedResult(
    displaySetService,
    viewportGridService,
    targetDisplaySet,
    viewportId
  );

  if (referencedDisplaySetAfterHydrate?.displaySetInstanceUID) {
    await ensureOverlayDisplaySetAttachedToViewport(
      viewportGridService,
      viewportId,
      referencedDisplaySetAfterHydrate.displaySetInstanceUID,
      targetDisplaySet.displaySetInstanceUID
    );
  }
};
