const fs = require('fs');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1300 } });
  await page.goto('http://localhost:3000/?configUrl=/config/local_orthanc.js', { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 1000, { timeout: 180000 });
  const confirm = page.getByText('Confirm and hide', { exact: true });
  if (await confirm.count()) await confirm.click();
  await page.evaluate(() => {
    const target = '/viewer?StudyInstanceUIDs=1.2.840.113704.9.1000.16.0.20150317132625248&configUrl=/config/local_orthanc.js';
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(8000);
  const skip = page.getByText('Skip all', { exact: true });
  if (await skip.count()) await skip.click();
  await page.waitForTimeout(1500);

  const snapshot = async label => page.evaluate(labelArg => {
    const vgs = window.services.viewportGridService;
    const dss = window.services.displaySetService;
    const ss = window.services.segmentationService;
    const state = vgs.getState();
    const viewportId = state.activeViewportId;
    const viewport = state.viewports.get(viewportId);
    const uids = viewport?.displaySetInstanceUIDs ?? [];
    const displaySets = uids.map(uid => {
      const ds = dss.getDisplaySetByUID(uid);
      return ds ? {
        uid,
        modality: ds.Modality ?? null,
        label: ds.SeriesDescription ?? ds.displaySetLabel ?? ds.label ?? ds.instances?.[0]?.SeriesDescription ?? null,
        isOverlayDisplaySet: !!ds.isOverlayDisplaySet,
        referencedDisplaySetInstanceUID: ds.referencedDisplaySetInstanceUID ?? null,
      } : { uid, missing: true };
    });
    let segmentationViewportIds = [];
    let segmentationRepresentations = [];
    try {
      segmentationViewportIds = ss.getViewportIdsWithSegmentation?.() ?? [];
      const reps = ss.getSegmentationRepresentations?.(viewportId) ?? [];
      segmentationRepresentations = reps.map(rep => ({
        segmentationId: rep.segmentationId,
        type: rep.type,
      }));
    } catch {}
    return {
      label: labelArg,
      viewportId,
      displaySets,
      segmentationViewportIds,
      segmentationRepresentations,
    };
  }, label);

  await page.locator('[data-cy="study-browser-thumbnail"]').click();
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const cm = window.commandsManager;
    await cm.runCommand('aiInferenceCheckBackendHealth', {}, 'AI_INFERENCE');
    await cm.runCommand('aiInferenceLoadModels', { silent: true }, 'AI_INFERENCE');
    await cm.runCommand('aiInferenceSetRunAsync', { value: false }, 'AI_INFERENCE');
  });

  const before = await snapshot('before');
  await page.evaluate(async () => {
    const cm = window.commandsManager;
    await cm.runCommand('aiInferenceSetSelectedModel', { value: 'monai' }, 'AI_INFERENCE');
    await cm.runCommand('aiInferenceRunInference', {}, 'AI_INFERENCE');
  });
  await page.waitForTimeout(15000);
  const afterMonai = await snapshot('afterMonai');

  await page.evaluate(async () => {
    const cm = window.commandsManager;
    await cm.runCommand('aiInferenceSetSelectedModel', { value: 'nnunet' }, 'AI_INFERENCE');
    await cm.runCommand('aiInferenceRunInference', {}, 'AI_INFERENCE');
  });
  await page.waitForTimeout(15000);
  const afterNnunet = await snapshot('afterNnunet');

  fs.writeFileSync('tmp-ai-overlay-validation.json', JSON.stringify({ before, afterMonai, afterNnunet }, null, 2));
  console.log('WROTE tmp-ai-overlay-validation.json');
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
