import React from 'react';
import { Types } from '@ohif/core';
import { AiInferencePanel } from './components/AiInferencePanel';
import { AI_PANEL_ICON_NAME, PANEL_ID } from './constants';

export default function getPanelModule({
  commandsManager,
  servicesManager,
}: Types.Extensions.ExtensionParams) {
  return [
    {
      name: PANEL_ID,
      iconName: AI_PANEL_ICON_NAME,
      iconLabel: 'AI',
      label: 'AI Inference',
      component: () => (
        <AiInferencePanel
          commandsManager={commandsManager}
          servicesManager={servicesManager}
        />
      ),
    },
  ];
}
