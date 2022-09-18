import dayjs from "dayjs";
import {
  BasalRecord,
  BolusRecord,
  CarbRecord,
  DeviceData,
  GlucoseRecord,
  PumpSettings,
} from "./diasend";
import {
  CorrectionBolusTreatment,
  ManualGlucoseValueEntry,
  MealBolusTreatment,
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

export function diasendBolusRecordToNightscoutTreatment(
  record: BolusRecord,
  allRecords: (BolusRecord | CarbRecord)[],
  device: DeviceData
): MealBolusTreatment | CorrectionBolusTreatment | undefined {
  const bolusRecord = record;
  // for a (meal) bolus, find the corresponding carbs record, if any
  // the carbs record is usually added ~1 minute later to diasend than the bolus for some reason
  // if it's not a meal bolus, it's a correction bolus
  const isMealBolus = "programmed_meal" in bolusRecord;
  if (isMealBolus) {
    const carbRecord = allRecords
      .filter<CarbRecord>((r): r is CarbRecord => r.type === "carb")
      .find(
        (r) =>
          // carbs should have been recorded within the next minute after bolus
          new Date(r.created_at) > new Date(bolusRecord.created_at) &&
          new Date(r.created_at).getTime() -
            new Date(bolusRecord.created_at).getTime() <=
            60 * 1000
      );

    const notesParts = [];
    if (!carbRecord) {
      // FIXME: schedule another run if carb event not yet found
      // for now, we just return the meal record without carbs and leave a note
      console.warn("Could not find corresponding carb value for bolus");
      notesParts.push(`Carbs unknown!`);
    }

    if (bolusRecord.programmed_bg_correction) {
      notesParts.push(`Correction: ${bolusRecord.programmed_bg_correction}`);
    }

    return {
      eventType: "Meal Bolus",
      insulin: bolusRecord.total_value,
      carbs: !carbRecord ? undefined : parseInt(carbRecord.value),
      notes: notesParts.length ? notesParts.join(", ") : undefined,
      app: "diasend",
      date: new Date(bolusRecord.created_at).getTime(),
      device: `${device.model} (${device.serial})`,
    };
  } else {
    if (bolusRecord.programmed_bg_correction) {
      return {
        eventType: "Correction Bolus",
        insulin: bolusRecord.programmed_bg_correction,
        app: "diasend",
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
