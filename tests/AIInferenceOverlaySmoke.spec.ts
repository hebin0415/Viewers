import { expect, type Locator, type Page, test } from '@playwright/test';

const STUDY_INSTANCE_UID = '1.2.840.113704.9.1000.16.0.20150317132625248';
const BACKEND_URL = 'http://127.0.0.1:8000/health';

const smokeCases = [
  {
    modelName: 'monai' as const,
    overlayModality: 'SEG',
    expectedLabel: /^AI \| monai .* SEG$/,
    title: 'run inference automatically attaches MONAI SEG overlay to the active viewport',
  },
  {
    modelName: 'nnunet' as const,
    overlayModality: 'RTSTRUCT',
    expectedLabel: /^AI \| nnunet .* RTSTRUCT$/,
    title: 'run inference automatically attaches nnUNet RTSTRUCT overlay to the active viewport',
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

async function configureAndRunInference(page: Page, modelName: 'monai' | 'nnunet') {
  await page.evaluate(async selectedModelName => {
    const commandsManager = window.commandsManager;
    await commandsManager.runCommand('aiInferenceCheckBackendHealth', {}, 'AI_INFERENCE');
    await commandsManager.runCommand('aiInferenceLoadModels', { silent: true }, 'AI_INFERENCE');
    await commandsManager.runCommand('aiInferenceSetRunAsync', { value: false }, 'AI_INFERENCE');
    await commandsManager.runCommand(
      'aiInferenceSetSelectedModel',
      { value: selectedModelName },
      'AI_INFERENCE'
    );
    await commandsManager.runCommand('aiInferenceRunInference', {}, 'AI_INFERENCE');
  }, modelName);
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
});
