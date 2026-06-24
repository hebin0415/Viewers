import { expect, type APIRequestContext, type Locator, type Page, test } from '@playwright/test';

const STUDY_INSTANCE_UID = '1.2.840.113704.9.1000.16.0.20150317132625248';
const SOURCE_SERIES_INSTANCE_UID = '1.2.840.113704.9.1000.16.1.2015031713345078300050001';
const BACKEND_URL = 'http://127.0.0.1:8000/health';
const BACKEND_INFER_URL = 'http://127.0.0.1:8000/infer';

const smokeCases = [
  {
    modelName: 'monai' as const,
    overlayModality: 'SEG',
    expectedLabel: /^AI \| monai .* SEG$/,
    title: 'run inference automatically attaches MONAI SEG overlay to the active viewport',
  },
  {
    modelName: 'nnunet' as const,
    overlayModality: 'SEG',
    expectedLabel: /^AI \| nnunet .* SEG$/,
    title: 'run inference automatically attaches nnUNet SEG overlay to the active viewport',
  },
];

type ViewportSnapshot = {
  viewportId: string | null;
  displaySets: Array<{
    uid: string;
    modality: string | null;
    label: string | null;
    overlay: boolean;
  }>;
};

type ActiveViewportImageState = {
  viewportId: string | null;
  modality: string | null;
  currentImageIndex: number | null;
  currentSOPInstanceUID: string | null;
};

type BackendInferenceOptions = {
  confidenceThreshold?: number;
  sparseSampleCount?: number;
  fullSeriesReview?: boolean;
};

type BackendInferenceResult = {
  payload: {
    storage?: {
      derivedSeriesDescription?: string | null;
    } | null;
    visualizations?: {
      detections?: Array<{
        sliceIndex?: number | null;
      }>;
    } | null;
  };
};

type ReferencedFinding = {
  text: string;
  referencedSOPInstanceUID: string | null;
};

type ResolvedDisplaySetSummary = {
  uid: string | null;
  modality: string | null;
  label: string | null;
};

function assertSourceDisplaySetStayedPrimary(
  before: ViewportSnapshot,
  after: ViewportSnapshot,
  overlayModality: string
) {
  expect(after.viewportId).toBe(before.viewportId);
  expect(before.displaySets).toHaveLength(1);
  expect(before.displaySets[0]?.modality).toBe('CT');
  expect(before.displaySets[0]?.overlay).toBe(false);

  expect(after.displaySets.length).toBeGreaterThanOrEqual(2);
  expect(after.displaySets[0]?.uid).toBe(before.displaySets[0]?.uid);
  expect(after.displaySets[0]?.modality).toBe('CT');
  expect(after.displaySets[0]?.overlay).toBe(false);

  const overlayIndex = after.displaySets.findIndex(
    displaySet => displaySet.overlay && displaySet.modality === overlayModality
  );

  expect(overlayIndex).toBeGreaterThan(0);
  expect(new Set(after.displaySets.map(displaySet => displaySet.uid)).size).toBe(
    after.displaySets.length
  );
}

async function dismissIfPresent(locator: Locator) {
  if (await locator.count()) {
    await locator.click({ force: true });
  }
}

async function dismissShepherdOverlay(page: Page) {
  await dismissIfPresent(page.getByText('Skip all', { exact: true }));

  await page.evaluate(() => {
    const activeTour = (window as Window & { Shepherd?: { activeTour?: { cancel?: () => void } } })
      .Shepherd?.activeTour;

    activeTour?.cancel?.();
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openStudyInViewer(page: Page) {
  await page.goto('/?configUrl=/config/local_orthanc.js', {
    waitUntil: 'load',
    timeout: 180_000,
  });

  await page.waitForFunction(
    () => (document.getElementById('root')?.innerHTML.length ?? 0) > 1000,
    {
      timeout: 180_000,
    }
  );

  await dismissIfPresent(page.getByText('Confirm and hide', { exact: true }));

  await page.evaluate(studyInstanceUID => {
    const target = `/viewer?StudyInstanceUIDs=${studyInstanceUID}&configUrl=/config/local_orthanc.js`;
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, STUDY_INSTANCE_UID);

  await expect(page.locator('[data-cy="study-browser-thumbnail"]').first()).toBeVisible({
    timeout: 180_000,
  });

  await dismissShepherdOverlay(page);
  await page.locator('[data-cy="study-browser-thumbnail"]').first().click({ force: true });

  await page.waitForFunction(() => {
    const state = window.services?.viewportGridService?.getState?.();
    return Boolean(state?.activeViewportId && state?.viewports?.get?.(state.activeViewportId));
  });
}

async function ensureAiPanelVisible(page: Page) {
  const reportButton = page.getByTestId('ai-generate-patient-report');
  if (await reportButton.isVisible().catch(() => false)) {
    return;
  }

  const aiPanelButton = page.locator('[data-cy="ai-inference-panel-btn"]').first();
  await expect(aiPanelButton).toBeVisible({ timeout: 30_000 });
  await dismissShepherdOverlay(page);
  await aiPanelButton.click({ force: true });

  await expect(reportButton).toBeVisible({ timeout: 30_000 });
}

async function generatePatientReportFromCommand(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    await window.commandsManager.runCommand('aiInferenceGeneratePatientReport', {}, 'AI_INFERENCE');

    const workflowState = (
      window as Window & {
        __AI_WORKFLOW_STORE__?: { getState: () => { patientReportText?: string | null } };
      }
    ).__AI_WORKFLOW_STORE__;

    return workflowState?.getState?.().patientReportText ?? null;
  });
}

async function generatePatientReportFromUi(page: Page): Promise<string | null> {
  await ensureAiPanelVisible(page);

  const reportButton = page.getByTestId('ai-generate-patient-report');
  await expect(reportButton).toBeVisible({ timeout: 30_000 });
  await dismissShepherdOverlay(page);
  await reportButton.click({ force: true });

  const reportOutput = page.getByTestId('ai-patient-report-output');
  await expect(reportOutput).toBeVisible({ timeout: 30_000 });
  await expect(reportOutput).toContainText('Patient AI Report', { timeout: 30_000 });

  return reportOutput.textContent();
}

async function getViewportSnapshot(page: Page): Promise<ViewportSnapshot> {
  return page.evaluate(() => {
    const state = window.services.viewportGridService.getState();
    const viewportId = state.activeViewportId ?? null;
    const viewport = viewportId ? state.viewports.get(viewportId) : null;
    const displaySetService = window.services.displaySetService;

    return {
      viewportId,
      displaySets: (viewport?.displaySetInstanceUIDs ?? []).map(uid => {
        const displaySet = displaySetService.getDisplaySetByUID(uid);

        return {
          uid,
          modality: displaySet?.Modality ?? null,
          label:
            displaySet?.SeriesDescription ??
            displaySet?.displaySetLabel ??
            displaySet?.label ??
            displaySet?.instances?.[0]?.SeriesDescription ??
            null,
          overlay: !!displaySet?.isOverlayDisplaySet,
        };
      }),
    };
  });
}

async function getActiveViewportImageState(page: Page): Promise<ActiveViewportImageState> {
  return page.evaluate(() => {
    const { viewportGridService, displaySetService, cornerstoneViewportService } = window.services;
    const state = viewportGridService.getState();
    const viewportId = state.activeViewportId ?? null;
    const viewport = viewportId ? state.viewports.get(viewportId) : null;
    const displaySetInstanceUID = viewport?.displaySetInstanceUIDs?.[0] ?? null;
    const displaySet = displaySetInstanceUID
      ? displaySetService.getDisplaySetByUID(displaySetInstanceUID)
      : null;
    const cornerstoneViewport = viewportId
      ? cornerstoneViewportService.getCornerstoneViewport(viewportId)
      : null;
    const currentImageId = cornerstoneViewport?.getCurrentImageId?.() ?? null;
    const imageIds: string[] = displaySet?.imageIds ?? [];
    const currentImageIndex = currentImageId ? imageIds.indexOf(currentImageId) : -1;
    const currentImage =
      displaySet?.images?.find(image => image.imageId === currentImageId) ?? null;
    const currentSOPInstanceUID =
      currentImage?.SOPInstanceUID ??
      (currentImageIndex >= 0
        ? (displaySet?.instances?.[currentImageIndex]?.SOPInstanceUID ?? null)
        : null);

    return {
      viewportId,
      modality: displaySet?.Modality ?? null,
      currentImageIndex: currentImageIndex >= 0 ? currentImageIndex : null,
      currentSOPInstanceUID,
    };
  });
}

async function runBackendInference(
  request: APIRequestContext,
  options: BackendInferenceOptions = {}
): Promise<BackendInferenceResult> {
  const response = await request.post(BACKEND_INFER_URL, {
    data: {
      modelName: 'yolo',
      taskType: 'detection',
      studyInstanceUID: STUDY_INSTANCE_UID,
      seriesInstanceUID: SOURCE_SERIES_INSTANCE_UID,
      options: {
        async: false,
        ...options,
      },
    },
    timeout: 180_000,
  });

  expect(response.ok()).toBeTruthy();
  return (await response.json()) as BackendInferenceResult;
}

function requireDerivedSeriesDescription(result: BackendInferenceResult): string {
  const seriesDescription = result.payload.storage?.derivedSeriesDescription ?? null;
  expect(seriesDescription).toBeTruthy();
  return seriesDescription as string;
}

async function openSeriesReport(page: Page, seriesDescription: string) {
  const srLabelButton = page
    .getByRole('button', {
      name: new RegExp(`^${escapeRegExp(seriesDescription)}$`),
    })
    .last();

  await expect(srLabelButton).toBeVisible({ timeout: 120_000 });
  await dismissShepherdOverlay(page);
  await srLabelButton.click({ force: true });

  const reportActivatedFromUi = await expect
    .poll(
      async () => {
        const findingCount = await page.getByTestId('sr-content-item-reference').count();
        if (findingCount > 0) {
          return true;
        }

        return page
          .getByText('Imaging Measurement Report', { exact: false })
          .isVisible()
          .catch(() => false);
      },
      {
        timeout: 8_000,
        intervals: [500, 1000, 1500],
      }
    )
    .toBeTruthy()
    .then(
      () => true,
      () => false
    );

  if (!reportActivatedFromUi) {
    const activated = await page.evaluate(targetSeriesDescription => {
      const { viewportGridService, displaySetService } = window.services;
      const state = viewportGridService.getState();
      const activeViewportId = state.activeViewportId;

      if (!activeViewportId) {
        return false;
      }

      const getDisplaySetLabel = displaySet =>
        displaySet?.SeriesDescription ??
        displaySet?.displaySetLabel ??
        displaySet?.label ??
        displaySet?.instances?.[0]?.SeriesDescription ??
        null;

      const targetDisplaySet = (displaySetService.getActiveDisplaySets?.() ?? []).find(
        displaySet => getDisplaySetLabel(displaySet) === targetSeriesDescription
      );

      if (!targetDisplaySet?.displaySetInstanceUID) {
        return false;
      }

      viewportGridService.setDisplaySetsForViewport({
        viewportId: activeViewportId,
        displaySetInstanceUIDs: [targetDisplaySet.displaySetInstanceUID],
      });

      return true;
    }, seriesDescription);

    expect(activated).toBe(true);
  }

  await expect(page.getByTestId('sr-content-item-reference').first()).toBeVisible({
    timeout: 30_000,
  });
}

async function collectReferencedFindings(page: Page): Promise<ReferencedFinding[]> {
  const referencedFindings = page.getByTestId('sr-content-item-reference');
  await expect(referencedFindings.first()).toBeVisible({ timeout: 30_000 });

  return referencedFindings.evaluateAll(elements =>
    elements.map(element => ({
      text: element.textContent?.trim() ?? '',
      referencedSOPInstanceUID: element.getAttribute('data-referenced-sop-instance-uid'),
    }))
  );
}

async function getResolvedDisplaySetForSop(
  page: Page,
  referencedSOPInstanceUID: string
): Promise<ResolvedDisplaySetSummary> {
  return page.evaluate(targetSopInstanceUID => {
    const displaySet = window.services.displaySetService.getDisplaySetForSOPInstanceUID(
      targetSopInstanceUID,
      ''
    );

    return {
      uid: displaySet?.displaySetInstanceUID ?? null,
      modality: displaySet?.Modality ?? null,
      label:
        displaySet?.SeriesDescription ??
        displaySet?.displaySetLabel ??
        displaySet?.label ??
        displaySet?.instances?.[0]?.SeriesDescription ??
        null,
    };
  }, referencedSOPInstanceUID);
}

async function clickReferencedFindingAndAssertJump(page: Page, referencedSOPInstanceUID: string) {
  const resolvedDisplaySet = await getResolvedDisplaySetForSop(page, referencedSOPInstanceUID);
  expect(
    resolvedDisplaySet.modality,
    `Expected referenced SOP ${referencedSOPInstanceUID} to resolve to a source CT display set`
  ).toBe('CT');

  const referencedFinding = page.locator(
    `[data-cy="sr-content-item-reference"][data-referenced-sop-instance-uid="${referencedSOPInstanceUID}"]`
  );

  await expect(referencedFinding.first()).toBeVisible({ timeout: 30_000 });
  await dismissShepherdOverlay(page);
  await referencedFinding.first().click({ force: true });

  await expect
    .poll(async () => (await getActiveViewportImageState(page)).modality, {
      timeout: 30_000,
      intervals: [500, 1000, 1500],
    })
    .toBe('CT');

  await expect
    .poll(async () => (await getActiveViewportImageState(page)).currentSOPInstanceUID, {
      timeout: 30_000,
      intervals: [500, 1000, 1500],
    })
    .toBe(referencedSOPInstanceUID);

  await expect(page.getByTestId('ai-focused-finding-overlay')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ai-focused-finding-overlay')).toContainText('Site:', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('ai-focused-finding-overlay')).toContainText('Assessment:', {
    timeout: 30_000,
  });
}

async function deleteAiSeriesByDescription(
  page: Page,
  seriesDescription: string
): Promise<boolean> {
  return page.evaluate(async targetSeriesDescription => {
    const getDisplaySetLabel = displaySet =>
      displaySet?.SeriesDescription ??
      displaySet?.displaySetLabel ??
      displaySet?.label ??
      displaySet?.instances?.[0]?.SeriesDescription ??
      null;

    const displaySets = window.services.displaySetService.getActiveDisplaySets?.() ?? [];
    const target = displaySets.find(
      displaySet => getDisplaySetLabel(displaySet) === targetSeriesDescription
    );

    if (!target?.displaySetInstanceUID) {
      return false;
    }

    return window.commandsManager.runCommand(
      'aiInferenceDeleteDisplaySet',
      { displaySetInstanceUID: target.displaySetInstanceUID },
      'AI_INFERENCE'
    );
  }, seriesDescription);
}

async function configureAndRunInference(
  page: Page,
  modelName: 'monai' | 'nnunet' | 'yolo',
  taskType?: 'segmentation' | 'detection'
) {
  await page.evaluate(
    async ({ selectedModelName, selectedTaskType }) => {
      const commandsManager = window.commandsManager;
      await commandsManager.runCommand('aiInferenceCheckBackendHealth', {}, 'AI_INFERENCE');
      await commandsManager.runCommand('aiInferenceLoadModels', { silent: true }, 'AI_INFERENCE');
      await commandsManager.runCommand('aiInferenceSetRunAsync', { value: false }, 'AI_INFERENCE');
      await commandsManager.runCommand(
        'aiInferenceSetSelectedModel',
        { value: selectedModelName },
        'AI_INFERENCE'
      );
      if (selectedTaskType) {
        await commandsManager.runCommand(
          'aiInferenceSetSelectedTaskType',
          { value: selectedTaskType },
          'AI_INFERENCE'
        );
      }
      await commandsManager.runCommand('aiInferenceRunInference', {}, 'AI_INFERENCE');
    },
    { selectedModelName: modelName, selectedTaskType: taskType ?? null }
  );
}

test.describe('AI inference overlay smoke', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ request }) => {
    const response = await request.get(BACKEND_URL, { timeout: 30_000 });
    expect(
      response.ok(),
      'AI backend must be reachable at http://127.0.0.1:8000/health'
    ).toBeTruthy();
  });

  for (const smokeCase of smokeCases) {
    test(smokeCase.title, async ({ page }) => {
      await openStudyInViewer(page);

      const before = await getViewportSnapshot(page);

      await configureAndRunInference(page, smokeCase.modelName);

      await expect
        .poll(
          async () => {
            const snapshot = await getViewportSnapshot(page);
            return snapshot.displaySets.some(
              displaySet => displaySet.overlay && displaySet.modality === smokeCase.overlayModality
            );
          },
          {
            timeout: 120_000,
            intervals: [1000, 1500, 2000],
          }
        )
        .toBe(true);

      const after = await getViewportSnapshot(page);
      assertSourceDisplaySetStayedPrimary(before, after, smokeCase.overlayModality);

      const overlay = after.displaySets.find(
        displaySet => displaySet.overlay && displaySet.modality === smokeCase.overlayModality
      );
      expect(overlay).toBeDefined();
      expect(overlay?.uid).not.toBe(before.displaySets[0]?.uid);
      expect(overlay?.label).toMatch(smokeCase.expectedLabel);
    });
  }

  test('run inference lands YOLO SR and allows report finding click-through to the source CT slice', async ({
    page,
  }) => {
    await openStudyInViewer(page);
    await configureAndRunInference(page, 'yolo', 'detection');

    const yoloSrThumbnail = page.getByRole('button', { name: /^AI \| yolo .* SR$/ }).first();

    await expect(yoloSrThumbnail).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('Imaging Measurement Report', { exact: false })).toBeVisible({
      timeout: 30_000,
    });

    const referencedFinding = page.getByTestId('sr-content-item-reference').first();
    await expect(referencedFinding).toBeVisible({ timeout: 30_000 });

    const referencedSOPInstanceUID = await referencedFinding.getAttribute(
      'data-referenced-sop-instance-uid'
    );
    expect(referencedSOPInstanceUID).toBeTruthy();

    await dismissShepherdOverlay(page);
    await referencedFinding.click();

    await expect
      .poll(async () => (await getActiveViewportImageState(page)).modality, {
        timeout: 30_000,
        intervals: [500, 1000, 1500],
      })
      .toBe('CT');

    await expect
      .poll(async () => (await getActiveViewportImageState(page)).currentSOPInstanceUID, {
        timeout: 30_000,
        intervals: [500, 1000, 1500],
      })
      .toBe(referencedSOPInstanceUID);

    await expect(
      page.getByText(
        'Current active series is an AI result. Select an original source series before running inference.',
        { exact: true }
      )
    ).toBeHidden({ timeout: 30_000 });
  });

  test('YOLO SR supports multi-finding multi-slice click-through on live data', async ({
    page,
    request,
  }) => {
    const result = await runBackendInference(request, {
      confidenceThreshold: 0.05,
      sparseSampleCount: 3,
    });

    const detections = result.payload.visualizations?.detections ?? [];
    expect(detections.length).toBeGreaterThanOrEqual(3);

    const uniqueSliceIndexes = new Set(
      detections
        .map(detection => detection.sliceIndex)
        .filter((sliceIndex): sliceIndex is number => typeof sliceIndex === 'number')
    );

    expect(uniqueSliceIndexes.size).toBeGreaterThanOrEqual(2);

    const seriesDescription = requireDerivedSeriesDescription(result);

    await openStudyInViewer(page);
    await openSeriesReport(page, seriesDescription);

    const referencedFindings = await collectReferencedFindings(page);
    expect(referencedFindings.length).toBeGreaterThanOrEqual(3);

    const uniqueReferencedSOPs = Array.from(
      new Set(
        referencedFindings
          .map(finding => finding.referencedSOPInstanceUID)
          .filter((referencedSOPInstanceUID): referencedSOPInstanceUID is string =>
            Boolean(referencedSOPInstanceUID)
          )
      )
    );

    expect(uniqueReferencedSOPs.length).toBeGreaterThanOrEqual(2);

    await clickReferencedFindingAndAssertJump(page, uniqueReferencedSOPs[0]);
    await openSeriesReport(page, seriesDescription);
    await clickReferencedFindingAndAssertJump(
      page,
      uniqueReferencedSOPs[uniqueReferencedSOPs.length - 1]
    );
  });

  test('deleting an AI YOLO SR and regenerating it preserves report click-through', async ({
    page,
    request,
  }) => {
    const firstResult = await runBackendInference(request);
    const firstSeriesDescription = requireDerivedSeriesDescription(firstResult);

    await openStudyInViewer(page);
    await openSeriesReport(page, firstSeriesDescription);

    const firstFindings = await collectReferencedFindings(page);
    const firstReferencedSOPInstanceUID = firstFindings[0]?.referencedSOPInstanceUID;
    expect(firstReferencedSOPInstanceUID).toBeTruthy();

    await clickReferencedFindingAndAssertJump(page, firstReferencedSOPInstanceUID as string);

    const deleted = await deleteAiSeriesByDescription(page, firstSeriesDescription);
    expect(deleted).toBe(true);

    await expect
      .poll(
        async () =>
          await page
            .getByRole('button', {
              name: new RegExp(`^${escapeRegExp(firstSeriesDescription)}$`),
            })
            .count(),
        {
          timeout: 30_000,
          intervals: [500, 1000, 1500],
        }
      )
      .toBe(0);

    const regeneratedResult = await runBackendInference(request);
    const regeneratedSeriesDescription = requireDerivedSeriesDescription(regeneratedResult);
    expect(regeneratedSeriesDescription).not.toBe(firstSeriesDescription);

    await openStudyInViewer(page);
    await openSeriesReport(page, regeneratedSeriesDescription);

    const regeneratedFindings = await collectReferencedFindings(page);
    const regeneratedReferencedSOPInstanceUID = regeneratedFindings[0]?.referencedSOPInstanceUID;
    expect(regeneratedReferencedSOPInstanceUID).toBeTruthy();

    await clickReferencedFindingAndAssertJump(page, regeneratedReferencedSOPInstanceUID as string);
  });

  test('AI command generates a patient AI report from current-study AI results', async ({
    page,
  }) => {
    await openStudyInViewer(page);
    await configureAndRunInference(page, 'yolo', 'detection');

    const patientReportText = await generatePatientReportFromCommand(page);
    expect(patientReportText).toContain('Patient AI Report');
    expect(patientReportText).toContain('yolo detection');
  });

  test('AI panel button generates a patient AI report from current-study AI results', async ({
    page,
  }) => {
    await openStudyInViewer(page);
    await configureAndRunInference(page, 'yolo', 'detection');

    const patientReportText = await generatePatientReportFromUi(page);
    expect(patientReportText).toContain('Patient AI Report');
    expect(patientReportText).toContain('yolo detection');
  });
});
