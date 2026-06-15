import DisplaySetService from './DisplaySetService';

describe('DisplaySetService.deleteDisplaySet', () => {
  const createDisplaySet = (displaySetInstanceUID: string, seriesInstanceUID: string) => ({
    displaySetInstanceUID,
    SeriesInstanceUID: seriesInstanceUID,
    instances: [],
  });

  afterEach(() => {
    const service = new DisplaySetService();
    service.onModeExit();
  });

  test('does not remove the last active display set when deleting the same uid twice', () => {
    const service = new DisplaySetService();
    const sourceDisplaySet = createDisplaySet('source-display-set', 'series-source');
    const aiDisplaySet = createDisplaySet('ai-display-set', 'series-ai');

    service.addDisplaySets(sourceDisplaySet, aiDisplaySet);

    service.deleteDisplaySet('ai-display-set');
    service.deleteDisplaySet('ai-display-set');

    expect(service.getActiveDisplaySets()).toEqual([sourceDisplaySet]);
    expect(service.getDisplaySetByUID('source-display-set')).toEqual(sourceDisplaySet);
    expect(service.getDisplaySetByUID('ai-display-set')).toBeUndefined();
  });
});
