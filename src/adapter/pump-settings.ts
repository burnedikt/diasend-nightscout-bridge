import dayjs from "dayjs";
import { PumpSettings } from "../diasend";
import { BasalRecord } from "../diasend/types";
import { Profile, ProfileConfig, TimeBasedValue } from "../nightscout/types";
import config from "../utils/config";

function convertToTimeBasedValue([startTime, value]: [
  string,
  number
]): TimeBasedValue {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [hours, minutes, ..._] = startTime.split(":");
  return {
    value,
    time: [hours, minutes].join(":"),
    timeAsSeconds: parseInt(hours) * 3600 + parseInt(minutes) * 60,
  };
}

export function diasendPumpSettingsToNightscoutProfile(
  pumpSettings: PumpSettings
): ProfileConfig {
  return {
    sens: pumpSettings.insulinSensitivityProfile.map(convertToTimeBasedValue),
    basal: pumpSettings.basalProfile.map(convertToTimeBasedValue),
    carbratio: pumpSettings.insulinCarbRatioProfile.map(
      convertToTimeBasedValue
    ),
    target_high: pumpSettings.bloodGlucoseTargetHigh
      ? [
          {
            time: "00:00",
            value: pumpSettings.bloodGlucoseTargetHigh,
            timeAsSeconds: 0,
          },
        ]
      : [],
    target_low: pumpSettings.bloodGlucoseTargetLow
      ? [
          {
            time: "00:00",
            value: pumpSettings.bloodGlucoseTargetLow,
            timeAsSeconds: 0,
          },
        ]
      : [],
    ...(pumpSettings.insulinOnBoardDurationHours
      ? { dia: pumpSettings.insulinOnBoardDurationHours }
      : {}),
    units: pumpSettings.units,
    timezone: process.env.TZ,
  };
}

export function convertBasalRecord(basalRecord: BasalRecord): TimeBasedValue {
  const recordTime = dayjs(basalRecord.created_at);
  const recordTimeAsSeconds = recordTime.diff(
    recordTime.startOf("day"),
    "seconds"
  );
  return {
    time: recordTime.format(recordTime.get("seconds") ? "HH:mm:ss" : "HH:mm"),
    timeAsSeconds: recordTimeAsSeconds,
    value: basalRecord.value,
  };
}

export function updateNightScoutProfileWithPumpSettings(
  existingProfile: Profile,
  pumpSettings: PumpSettings,
  options: {
    nightscoutProfileName: string;
  } = {
    nightscoutProfileName: config.nightscout.profileName,
  }
): Profile {
  const pumpSettingsAsProfileConfig =
    diasendPumpSettingsToNightscoutProfile(pumpSettings);

  const previousProfileConfig =
    existingProfile.store[options.nightscoutProfileName] ?? {};

  return {
    ...existingProfile,
    store: {
      ...(existingProfile.store ?? {}),
      [options.nightscoutProfileName]: {
        ...previousProfileConfig,
        basal: pumpSettingsAsProfileConfig.basal,
      },
    },
  };
}
