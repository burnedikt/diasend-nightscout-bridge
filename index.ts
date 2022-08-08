import config from "./config";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  obtainDiasendAccessToken,
  PatientRecord,
  getPatientData,
} from "./diasend";
import {
  NightscoutSensorGlucoseValueEntry,
  reportCgmToNightScout,
} from "./nightscout";

dayjs.extend(relativeTime);

function diasendPatientRecordToNightscoutEntry(
  record: PatientRecord
): NightscoutSensorGlucoseValueEntry {
  const date = new Date(record.created_at);
  return {
    type: "sgv",
    sgv: record.value,
    dateString: date.toISOString(),
    date: date.getTime(),
  };
}

interface SyncDiasendDataToNightScoutArgs {
  diasendUsername?: string;
  diasendPassword?: string;
  diasendClientId?: string;
  diasendClientSecret?: string;
  nightscoutEntriesHandler?: (
    entries: NightscoutSensorGlucoseValueEntry[]
  ) => Promise<void>;
  dateFrom?: Date;
  dateTo?: Date;
}

async function syncDiasendDataToNigthscout({
  diasendUsername = config.diasend.username,
  diasendPassword = config.diasend.password,
  diasendClientId = config.diasend.clientId,
  diasendClientSecret = config.diasend.clientSecret,
  nightscoutEntriesHandler = async (cgmRecords) =>
    await reportCgmToNightScout(cgmRecords),
  dateFrom = dayjs().subtract(10, "minutes").toDate(),
  dateTo = new Date(),
}: SyncDiasendDataToNightScoutArgs) {
  if (!diasendUsername) {
    throw Error("Diasend Username not configured");
  }
  if (!diasendPassword) {
    throw Error("Diasend Password not configured");
  }

  const { access_token: diasendAccessToken } = await obtainDiasendAccessToken(
    diasendClientId,
    diasendClientSecret,
    diasendUsername,
    diasendPassword
  );

  // using the diasend token, now fetch the patient records
  const records = await getPatientData(diasendAccessToken, dateFrom, dateTo);
  console.log(
    "Number of diasend records since",
    dayjs(dateFrom).fromNow(),
    records.length
  );

  // extract all CGM values first
  const cgmRecords = records
    // TODO: support non-glucose type values
    // TODO: treat calibration events differently?
    .filter((record) => record.type === "glucose")
    .map(diasendPatientRecordToNightscoutEntry);

  // send them to nightscout
  console.log(`Sending ${cgmRecords.length} records to nightscout`);
  await nightscoutEntriesHandler(cgmRecords);
}

// CamAPSFx uploads data to diasend every 5 minutes. (Which is also the time after which new CGM values from Dexcom will be available)
const interval = 5 * 60 * 1000;

let synchronizationTimeoutId: NodeJS.Timeout | undefined | number;
export function startSynchronization({
  pollingIntervalMs = interval,
  dateFrom = dayjs().subtract(interval, "milliseconds").toDate(),
  ...syncArgs
}: {
  pollingIntervalMs?: number;
} & SyncDiasendDataToNightScoutArgs = {}) {
  syncDiasendDataToNigthscout({ dateFrom, ...syncArgs }).finally(() => {
    // next run's data should be fetched where this run ended
    const nextDateFrom = new Date();
    // schedule the next run
    console.log(
      `Next run will be in ${dayjs()
        .add(pollingIntervalMs, "milliseconds")
        .fromNow()}...`
    );
    // if synchronizationTimeoutId is set to 0 when we get here, don't schedule a re-run. This is the exit condition
    // and prevents the synchronization loop from continuing if the timeout is cleared while already running the sync
    if (synchronizationTimeoutId !== 0) {
      synchronizationTimeoutId = setTimeout(() => {
        void startSynchronization({
          pollingIntervalMs,
          ...syncArgs,
          dateFrom: nextDateFrom,
        });
      }, pollingIntervalMs);
    }
  });

  // return a function that can be used to end the loop
  return () => {
    clearTimeout(synchronizationTimeoutId);
  };
}
