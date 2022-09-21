import dayjs from "dayjs";
import config from "./config";
import {
  BasalRecord,
  BolusRecord,
  CarbRecord,
  DeviceData,
  GlucoseRecord,
  PatientRecord,
  PumpSettings,
} from "./diasend";
import {
  CarbCorrectionTreatment,
  CorrectionBolusTreatment,
  ManualGlucoseValueEntry,
  MealBolusTreatment,
  Profile,
  ProfileConfig,
  SensorGlucoseValueEntry,
  TimeBasedValue,
} from "./nightscout";

export function diasendGlucoseRecordToNightscoutEntry(
  record: GlucoseRecord,
  device: DeviceData
): SensorGlucoseValueEntry | ManualGlucoseValueEntry {
  // FIXME: The created_at datetimes from diasend do not contain any timezone information which can be problematic
  const date = new Date(record.created_at);

  const isManualBloodGlucose = record.flags.find(
    (f) => f.description === "Manual"
  );

  const shared = {
    dateString: date.toISOString(),
    date: date.getTime(),
    app: "diasend",
    device: `${device.model} (${device.serial})`,
  };

  if (isManualBloodGlucose) {
    return {
      type: "mbg",
      mbg: record.value,
      ...shared,
    };
  } else {
    return {
      type: "sgv",
      direction: undefined, // TODO: we currently cannot obtain the direction / trend from diasend
      sgv: record.value,
      ...shared,
    };
  }
}

// carbs should have been recorded within the next minute after a meal bolus
const diasendBolusCarbTimeDifferenceThresholdMilliseconds = 60 * 1000;
const nightscoutApp = "diasend";

function doCarbsBelongToBolus(
  carbRecord: CarbRecord,
  others: (CarbRecord | BolusRecord)[]
) {
  return !!others
    .filter<BolusRecord>(
      (r): r is BolusRecord =>
        r.type === "insulin_bolus" && "programmed_meal" in r
    )
    .find((bolusRecord) =>
      isRecordCreatedWithinTimeSpan(
        carbRecord,
        bolusRecord,
        diasendBolusCarbTimeDifferenceThresholdMilliseconds
      )
    );
}

function isRecordCreatedWithinTimeSpan(
  r1: PatientRecord,
  r2: PatientRecord,
  timespanMilliseconds: number
) {
  return (
    dayjs(r1.created_at) > dayjs(r2.created_at) &&
    dayjs(r1.created_at).diff(r2.created_at) <= timespanMilliseconds
  );
}

export function diasendRecordToNightscoutTreatment(
  record: BolusRecord | CarbRecord,
  allRecords: (BolusRecord | CarbRecord)[],
  device: DeviceData
):
  | MealBolusTreatment
  | CorrectionBolusTreatment
  | CarbCorrectionTreatment
  | undefined {
  // if there's a carb record, check if there's a preceeding (meal) bolus record
  if (record.type == "carb") {
    // if so, it's a meal / snack bolus and already handled
    if (doCarbsBelongToBolus(record, allRecords)) return undefined;
    // if not so, it's a hypoglycaemia treatment and we need to create a treatment for it
    return {
      eventType: "Carb Correction",
      carbs: parseInt(record.value),
      app: nightscoutApp,
      date: new Date(record.created_at).getTime(),
      device: `${device.model} (${device.serial})`,
    };
  }

  const bolusRecord = record;
  // for a (meal) bolus, find the corresponding carbs record, if any
  // the carbs record is usually added ~1 minute later to diasend than the bolus for some reason
  // if it's not a meal bolus, it's a correction bolus
  const isMealBolus = "programmed_meal" in bolusRecord;
  if (isMealBolus) {
    const carbRecord = allRecords
      .filter<CarbRecord>(
        (record): record is CarbRecord => record.type === "carb"
      )
      .find(
        // carbs should have been recorded within the next minute after bolus
        (carbRecord) =>
          isRecordCreatedWithinTimeSpan(
            carbRecord,
            bolusRecord,
            diasendBolusCarbTimeDifferenceThresholdMilliseconds
          )
      );

    const notesParts = [];
    if (!carbRecord) {
      throw new Error("Could not find matching carb record. Please retry.");
    }

    if (bolusRecord.programmed_bg_correction) {
      notesParts.push(`Correction: ${bolusRecord.programmed_bg_correction}`);
    }

    return {
      eventType: "Meal Bolus",
      insulin: bolusRecord.total_value,
      carbs: !carbRecord ? undefined : parseInt(carbRecord.value),
      notes: notesParts.length ? notesParts.join(", ") : undefined,
      app: nightscoutApp,
      date: new Date(bolusRecord.created_at).getTime(),
      device: `${device.model} (${device.serial})`,
    };
  } else {
    if (bolusRecord.programmed_bg_correction) {
      return {
        eventType: "Correction Bolus",
        insulin: bolusRecord.programmed_bg_correction,
        app: nightscoutApp,
        date: new Date(bolusRecord.created_at).getTime(),
        device: `${device.model} (${device.serial})`,
      };
    } else {
      console.warn("Bolus record cannot be handled", bolusRecord);
      return;
    }
  }
}

function convertToTimeBasedValue([startTime, value]: [
  string,
  number
]): TimeBasedValue {
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
    target_high: [
      {
        time: "00:00",
        value: pumpSettings.bloodGlucoseTargetHigh,
        timeAsSeconds: 0,
      },
    ],
    target_low: [
      {
        time: "00:00",
        value: pumpSettings.bloodGlucoseTargetLow,
        timeAsSeconds: 0,
      },
    ],
    dia: pumpSettings.insulinOnBoardDurationHours,
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

export function updateBasalProfile(
  basalProfile: TimeBasedValue[],
  basalRecords: BasalRecord[]
): TimeBasedValue[] {
  let updatedBasalProfile = [...basalProfile];

  // ensure the basalRecords are sorted ascending by their datetime
  basalRecords
    .sort((b1, b2) => dayjs(b1.created_at).diff(dayjs(b2.created_at)))
    .forEach((basalRecord) => {
      const recordTime = dayjs(basalRecord.created_at);
      const recordTimeAsSeconds = recordTime.diff(
        recordTime.startOf("day"),
        "seconds"
      );
      // delete all entries in the current basal profile after the record
      updatedBasalProfile = updatedBasalProfile.filter(
        (entry) =>
          entry.timeAsSeconds !== undefined &&
          entry.timeAsSeconds < recordTimeAsSeconds
      );
      // add the new entry
      updatedBasalProfile.push(convertBasalRecord(basalRecord));
    });

  return updatedBasalProfile;
}

export function updateNightScoutProfileWithPumpSettings(
  existingProfile: Profile,
  pumpSettings: PumpSettings,
  options: {
    importBasalRate: boolean;
    nightscoutProfileName: string;
  } = {
    importBasalRate: true,
    nightscoutProfileName: config.nightscout.profileName!,
  }
): Profile {
  const pumpSettingsAsProfileConfig =
    diasendPumpSettingsToNightscoutProfile(pumpSettings);

  const previousProfileConfig =
    existingProfile.store[options.nightscoutProfileName] || {};

  return {
    ...existingProfile,
    store: {
      ...existingProfile.store,
      [options.nightscoutProfileName]: {
        ...previousProfileConfig,
        basal: options.importBasalRate
          ? pumpSettingsAsProfileConfig.basal
          : previousProfileConfig.basal,
      },
    },
  };
}
