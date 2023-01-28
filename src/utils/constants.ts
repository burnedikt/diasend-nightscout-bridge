// the default duration for temp basal events
// diasend doesn't provide any duration but we need it for nightscout
export const defaultTempBasalDurationMinutes = 360 as const;

// carbs should have been recorded within ten minutes after / before a meal bolus
export const diasendBolusCarbTimeDifferenceThresholdMilliseconds =
  10 * 60 * 1000;

// CamAPSFx uploads data to diasend every 5 minutes. (Which is also the time after which new CGM values from Dexcom will be available)
export const defaultPollingInterval = 5 * 60 * 1000;

// per default synchronize pump settings every 12 hours
export const defaultPollingIntervalPumpSettings = 12 * 3600 * 1000;
