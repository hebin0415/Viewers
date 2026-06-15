import React from 'react';
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  Icons,
} from '@ohif/ui-next';
import { AiViewportOverlay } from './components/AiViewportOverlay';

const AI_RESULT_PREFIX = 'AI |';

const isAiResultLabel = (value?: string | null) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .startsWith(AI_RESULT_PREFIX.toUpperCase());

const getIsAiDeleteDisabled = ({
  item,
  servicesManager,
  displaySetInstanceUID,
}: {
  item: { id?: string };
  servicesManager?: AppTypes.ServicesManager;
  displaySetInstanceUID?: string;
}) => {
  if (item.id !== 'aiInferenceDeleteSeries') {
    return false;
  }

  const displaySetService = (servicesManager?.services as AppTypes.Services | undefined)
    ?.displaySetService;
  if (!displaySetService || !displaySetInstanceUID) {
    return true;
  }

  const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID) as
    | {
        SeriesDescription?: string;
        displaySetLabel?: string;
        label?: string;
        instances?: Array<{ SeriesDescription?: string }>;
      }
    | undefined;

  const label =
    displaySet?.SeriesDescription ??
    displaySet?.displaySetLabel ??
    displaySet?.label ??
    displaySet?.instances?.[0]?.SeriesDescription ??
    '';

  return !isAiResultLabel(label);
};

const menuContentCustomization = {
  'ohif.menuContent': function (props) {
    const { item: topLevelItem, commandsManager, servicesManager, ...rest } = props;

    const content = function (subProps) {
      const { item: subItem } = subProps;
      const isSelectorDisabled = subItem.selector && !subItem.selector({ servicesManager });
      const isAiDeleteDisabled = getIsAiDeleteDisabled({
        item: subItem,
        servicesManager,
        displaySetInstanceUID: rest.displaySetInstanceUID,
      });
      const isDisabled = isSelectorDisabled || isAiDeleteDisabled;

      return (
        <DropdownMenuItem
          disabled={isDisabled}
          onSelect={() => {
            if (isDisabled) {
              return;
            }

            commandsManager.runAsync(subItem.commands, {
              ...subItem.commandOptions,
              ...rest,
            });
          }}
          className="gap-[6px]"
        >
          {subItem.iconName && (
            <Icons.ByName
              name={subItem.iconName}
              className="-ml-1"
            />
          )}
          {subItem.label}
        </DropdownMenuItem>
      );
    };

    if (topLevelItem.items) {
      return (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-[6px]">
            {topLevelItem.iconName && (
              <Icons.ByName
                name={topLevelItem.iconName}
                className="-ml-1"
              />
            )}
            {topLevelItem.label}
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              {topLevelItem.items.map(subItem => content({ ...props, item: subItem }))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      );
    }

    return content({ ...props, item: topLevelItem });
  },
};

export default function getCustomizationModule() {
  return [
    {
      name: 'default',
      value: {
        ...menuContentCustomization,
        'studyBrowser.thumbnailMenuItems': {
          $push: [
            {
              id: 'aiInferenceDeleteSeries',
              label: 'Delete',
              iconName: 'Delete',
              commands: {
                commandName: 'aiInferenceDeleteDisplaySet',
                context: 'AI_INFERENCE',
              },
            },
          ],
        },
        'viewportOverlay.topRight': [
          {
            id: 'aiInference.viewportOverlay',
            contentF: () => <AiViewportOverlay />,
          },
        ],
      },
    },
  ];
}
