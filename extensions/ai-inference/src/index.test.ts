import extension from './index';
import { id } from './id';
import { ModelFactory } from './core/factories/ModelFactory';

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
