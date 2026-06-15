import { Icons } from '@ohif/ui-next';
import { AI_PANEL_ICON_NAME } from './constants';
import TabAiInference from './icons/TabAiInference';

let iconsRegistered = false;

export default function registerIcons(): void {
  if (iconsRegistered) {
    return;
  }

  Icons.addIcon(AI_PANEL_ICON_NAME, TabAiInference);
  iconsRegistered = true;
}
