import layoutSelectorCustomization from './layoutSelectorCustomization';

describe('layoutSelectorCustomization', () => {
  const generateAdvancedPresets =
    layoutSelectorCustomization['layoutSelector.advancedPresetGenerator'];

  test('ignores stale display set uids instead of crashing', () => {
    const servicesManager = {
      services: {
        hangingProtocolService: {
          protocols: new Map([
            [
              'preset-1',
              {
                id: 'preset-1',
                name: 'Preset 1',
                icon: 'icon-1',
                isPreset: true,
                displaySetSelectors: {},
              },
            ],
          ]),
          areRequiredSelectorsValid: jest.fn(() => true),
        },
        viewportGridService: {
          getActiveViewportId: jest.fn(() => 'viewport-1'),
          getDisplaySetsUIDsForViewport: jest.fn(() => [
            'missing-display-set',
            'source-display-set',
          ]),
        },
        displaySetService: {
          getDisplaySetByUID: jest.fn((displaySetInstanceUID: string) => {
            if (displaySetInstanceUID === 'source-display-set') {
              return {
                displaySetInstanceUID,
                Modality: 'CT',
              };
            }

            return undefined;
          }),
        },
      },
    } as unknown as AppTypes.ServicesManager;

    expect(generateAdvancedPresets({ servicesManager })).toEqual([
      {
        icon: 'icon-1',
        title: 'Preset 1',
        commandOptions: {
          protocolId: 'preset-1',
        },
        disabled: false,
      },
    ]);
  });

  test('resolves SR display sets through their referenced image display set', () => {
    const areRequiredSelectorsValid = jest.fn(() => true);
    const servicesManager = {
      services: {
        hangingProtocolService: {
          protocols: new Map([
            [
              'preset-1',
              {
                id: 'preset-1',
                name: 'Preset 1',
                icon: 'icon-1',
                isPreset: true,
                displaySetSelectors: {
                  primary: { id: 'primary' },
                },
              },
            ],
          ]),
          areRequiredSelectorsValid,
        },
        viewportGridService: {
          getActiveViewportId: jest.fn(() => 'viewport-1'),
          getDisplaySetsUIDsForViewport: jest.fn(() => ['sr-display-set']),
        },
        displaySetService: {
          getDisplaySetByUID: jest.fn((displaySetInstanceUID: string) => {
            if (displaySetInstanceUID === 'sr-display-set') {
              return {
                displaySetInstanceUID,
                Modality: 'SR',
                measurements: [{ displaySetInstanceUID: 'referenced-display-set' }],
              };
            }

            if (displaySetInstanceUID === 'referenced-display-set') {
              return {
                displaySetInstanceUID,
                Modality: 'CT',
              };
            }

            return undefined;
          }),
        },
      },
    } as unknown as AppTypes.ServicesManager;

    generateAdvancedPresets({ servicesManager });

    expect(areRequiredSelectorsValid).toHaveBeenCalledWith(
      [{ id: 'primary' }],
      expect.objectContaining({
        displaySetInstanceUID: 'referenced-display-set',
        Modality: 'CT',
      })
    );
  });
});
