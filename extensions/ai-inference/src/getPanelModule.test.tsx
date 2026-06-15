import React from 'react';
import getPanelModule from './getPanelModule';
import { AI_PANEL_ICON_NAME, PANEL_ID } from './constants';

describe('getPanelModule', () => {
  test('uses a dedicated AI panel icon instead of the segmentation tab icon', () => {
    const [panel] = getPanelModule({
      commandsManager: {} as any,
      servicesManager: {} as any,
    });

    expect(panel.name).toBe(PANEL_ID);
    expect(panel.iconName).toBe(AI_PANEL_ICON_NAME);
  });
});
