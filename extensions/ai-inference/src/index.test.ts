import { id } from './id';
import { ModelFactory } from './core/factories/ModelFactory';

jest.mock('./getCustomizationModule', () => jest.fn());
jest.mock('./getCommandsModule', () => jest.fn());
jest.mock('./getPanelModule', () => jest.fn());
jest.mock('./getToolbarModule', () => jest.fn());
jest.mock('./registerIcons', () => jest.fn());

import extension from './index';

describe('ai-inference extension scaffold', () => {
  test('exports the expected extension id', () => {
    expect(id).toBe('@ohif/extension-ai-inference');
  });

  test('declares the supported model families', () => {
    expect(ModelFactory.listSupportedFamilies()).toEqual(['nnunet', 'yolo', 'monai']);
  });

  test('registers panel, toolbar, and commands modules', () => {
    expect(extension.getPanelModule).toBeDefined();
    expect(extension.getToolbarModule).toBeDefined();
    expect(extension.getCommandsModule).toBeDefined();
    expect(extension.getCustomizationModule).toBeDefined();
  });
});
