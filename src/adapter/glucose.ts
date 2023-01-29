import * as logger from "loglevel";
import {
  GlucoseRecord,
  PatientRecord,
  PatientRecordWithDeviceData,
} from "../diasend/types";
import { SynchronizeOptions } from "../index";
import {
  Entry,
  ManualGlucoseValueEntry,
  SensorGlucoseValueEntry,
} from "../nightscout/types";
import { diasendImportnightscoutApp } from "./const";

export function diasendGlucoseRecordToNightscoutEntry(
  record: PatientRecordWithDeviceData<GlucoseRecord>
): SensorGlucoseValueEntry | ManualGlucoseValueEntry {
  // FIXME: The created_at datetimes from diasend do not contain any timezone information which can be problematic
  const date = new Date(record.created_at);

  const isManualBloodGlucose = record.flags.find(
    (f) => f.description === "Manual"
  );

  const shared = {
    dateString: date.toISOString(),
    date: date.getTime(),
    app: diasendImportnightscoutApp,
    device: `${record.device.model} (${record.device.serial})`,
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

export async function synchronizeGlucoseRecords(
  records: PatientRecordWithDeviceData<PatientRecord>[],
  { nightscoutClient }: SynchronizeOptions
) {
  const nightscoutEntries = records
    .filter<PatientRecordWithDeviceData<GlucoseRecord>>(
      (record): record is PatientRecordWithDeviceData<GlucoseRecord> =>
        record.type === "glucose"
    )
    .map<Entry>((record) => diasendGlucoseRecordToNightscoutEntry(record));
  logger.info(
    `Sending ${nightscoutEntries.length} (glucose) entries to nightscout`
  );
  return await nightscoutClient.createEntries(nightscoutEntries);
}
