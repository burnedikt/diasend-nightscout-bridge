import { BolusRecord, CarbRecord, DeviceData, GlucoseRecord } from "./diasend";
import {
  CorrectionBolusTreatment,
  ManualGlucoseValueEntry,
  MealBolusTreatment,
  SensorGlucoseValueEntry,
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
