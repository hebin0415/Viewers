import PropTypes from 'prop-types';
import React, { useEffect, useState } from 'react';
import { ExtensionManager } from '@ohif/core';

import OHIFCornerstoneSRMeasurementViewport from './OHIFCornerstoneSRMeasurementViewport';
import OHIFCornerstoneSRTextViewport from './OHIFCornerstoneSRTextViewport';

function hasRenderableMeasurements(displaySet) {
  return Array.isArray(displaySet?.measurements)
    ? displaySet.measurements.some(
        measurement => measurement?.displaySetInstanceUID || measurement?.coords?.length
      )
    : false;
}

function OHIFCornerstoneSRViewport(props: withAppTypes) {
  const { displaySets } = props;
  const displaySet = displaySets[0];
  const { isImagingMeasurementReport } = displaySet;
  const [shouldUseMeasurementViewport, setShouldUseMeasurementViewport] = useState(
    isImagingMeasurementReport && hasRenderableMeasurements(displaySet)
  );

  useEffect(() => {
    let isMounted = true;

    const resolveViewportType = async () => {
      if (!isImagingMeasurementReport) {
        if (isMounted) {
          setShouldUseMeasurementViewport(false);
        }
        return;
      }

      if (!displaySet.isLoaded) {
        await displaySet.load();
      }

      if (isMounted) {
        setShouldUseMeasurementViewport(hasRenderableMeasurements(displaySet));
      }
    };

    resolveViewportType();

    return () => {
      isMounted = false;
    };
  }, [displaySet, isImagingMeasurementReport]);

  if (shouldUseMeasurementViewport) {
    return <OHIFCornerstoneSRMeasurementViewport {...props}></OHIFCornerstoneSRMeasurementViewport>;
  }

  return <OHIFCornerstoneSRTextViewport {...props}></OHIFCornerstoneSRTextViewport>;
}

OHIFCornerstoneSRViewport.propTypes = {
  displaySets: PropTypes.arrayOf(PropTypes.object),
  viewportId: PropTypes.string.isRequired,
  dataSource: PropTypes.object,
  children: PropTypes.node,
  viewportLabel: PropTypes.string,
  viewportOptions: PropTypes.object,
  servicesManager: PropTypes.object.isRequired,
  extensionManager: PropTypes.instanceOf(ExtensionManager).isRequired,
};

export default OHIFCornerstoneSRViewport;
