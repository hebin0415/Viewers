import { Types } from '@ohif/core';
import getCustomizationModule from './getCustomizationModule';
import getCommandsModule from './getCommandsModule';
import getPanelModule from './getPanelModule';
import getToolbarModule from './getToolbarModule';
import { id } from './id';
import registerIcons from './registerIcons';

const extension: Types.Extensions.Extension = {
  id,
  preRegistration: () => {
    registerIcons();
  },
  getCommandsModule,
  getCustomizationModule,
  getPanelModule,
  getToolbarModule,
};

export default extension;
