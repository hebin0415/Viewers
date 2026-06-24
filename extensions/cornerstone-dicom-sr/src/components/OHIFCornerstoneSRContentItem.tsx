import PropTypes from 'prop-types';
import React from 'react';
import { useSystem } from '@ohif/core/src/contextProviders/SystemProvider';
import { CodeNameCodeSequenceValues } from '../enums';
import formatContentItemValue from '../utils/formatContentItem';

const EMPTY_TAG_VALUE = '[empty]';

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getReferencedSOPInstanceUID(contentItem) {
  const referencedSOPSequence = asArray(contentItem?.ReferencedSOPSequence);
  const referencedSOPInstanceUID = referencedSOPSequence[0]?.ReferencedSOPInstanceUID;

  if (referencedSOPInstanceUID) {
    return referencedSOPInstanceUID;
  }

  for (const childItem of asArray(contentItem?.ContentSequence)) {
    const nestedReference = getReferencedSOPInstanceUID(childItem);
    if (nestedReference) {
      return nestedReference;
    }
  }

  return null;
}

function OHIFCornerstoneSRContentItem(props) {
  const { contentItem, nodeIndexesTree, continuityOfContent } = props;
  const { commandsManager, servicesManager } = useSystem();
  const { ConceptNameCodeSequence } = contentItem;
  const { CodeValue, CodeMeaning } = ConceptNameCodeSequence;
  const isChildFirstNode = nodeIndexesTree[nodeIndexesTree.length - 1] === 0;
  const formattedValue = formatContentItemValue(contentItem) ?? EMPTY_TAG_VALUE;
  const startWithAlphaNumCharRegEx = /^[a-zA-Z0-9]/;
  const isContinuous = continuityOfContent === 'CONTINUOUS';
  const isFinding = CodeValue === CodeNameCodeSequenceValues.Finding;
  const referencedSOPInstanceUID = getReferencedSOPInstanceUID(contentItem);
  const addExtraSpace =
    isContinuous && !isChildFirstNode && startWithAlphaNumCharRegEx.test(formattedValue?.[0]);

  // Collapse sequences of white space preserving newline characters
  let className = 'whitespace-pre-line';

  if (CodeValue === CodeNameCodeSequenceValues.Finding) {
    // Preserve spaces because it is common to see tabular text in a
    // "Findings" ConceptNameCodeSequence
    className = 'whitespace-pre-wrap';
  }

  const jumpToReferencedImage = () => {
    if (!referencedSOPInstanceUID) {
      return;
    }

    const { displaySetService, viewportGridService } = servicesManager.services;
    const { activeViewportId } = viewportGridService.getState();

    if (!activeViewportId) {
      return;
    }

    const sourceDisplaySet = displaySetService.getDisplaySetForSOPInstanceUID(
      referencedSOPInstanceUID,
      ''
    );

    if (!sourceDisplaySet) {
      return;
    }

    const referencedImage = sourceDisplaySet.images?.find(
      image => image.SOPInstanceUID === referencedSOPInstanceUID
    );
    const referencedImageId = referencedImage?.imageId ?? null;
    const imageIndex = referencedImageId
      ? (sourceDisplaySet.imageIds?.indexOf(referencedImageId) ?? -1)
      : -1;

    viewportGridService.setDisplaySetsForViewport({
      viewportId: activeViewportId,
      displaySetInstanceUIDs: [sourceDisplaySet.displaySetInstanceUID],
    });

    window.requestAnimationFrame(() => {
      if (imageIndex >= 0) {
        commandsManager.runCommand('jumpToImage', {
          imageIndex,
          viewport: { id: activeViewportId },
        });
      }

      window.requestAnimationFrame(() => {
        commandsManager.runCommand(
          'aiInferenceRenderFindingFromSr',
          {
            findingText: formattedValue,
            referencedSOPInstanceUID,
          },
          'AI_INFERENCE'
        );
      });
    });
  };

  const renderValue = () => {
    const valueContent = (
      <>
        {addExtraSpace ? ' ' : ''}
        {formattedValue}
      </>
    );

    if (!referencedSOPInstanceUID) {
      return isFinding ? (
        <pre>{formattedValue}</pre>
      ) : (
        <span className={className}>{valueContent}</span>
      );
    }

    return (
      <button
        type="button"
        className={className}
        data-cy="sr-content-item-reference"
        data-referenced-sop-instance-uid={referencedSOPInstanceUID}
        onClick={jumpToReferencedImage}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          padding: 0,
          textAlign: 'left',
          textDecoration: 'underline',
          textUnderlineOffset: '0.15em',
        }}
        title={`Jump to referenced image for ${CodeMeaning}`}
      >
        {isFinding ? <pre>{formattedValue}</pre> : valueContent}
      </button>
    );
  };

  if (isContinuous) {
    return (
      <>
        <span
          className={className}
          title={CodeMeaning}
        >
          {renderValue()}
        </span>
      </>
    );
  }

  return (
    <>
      <div className="mb-2">
        <span className="font-bold">{CodeMeaning}: </span>
        {renderValue()}
      </div>
    </>
  );
}

OHIFCornerstoneSRContentItem.propTypes = {
  contentItem: PropTypes.object,
  nodeIndexesTree: PropTypes.arrayOf(PropTypes.number),
  continuityOfContent: PropTypes.string,
};

export { OHIFCornerstoneSRContentItem };
