import config from "./config";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  obtainDiasendAccessToken,
  PatientRecord,
  getPatientData,
} from "./diasend";
import {
  getLatestCgmUpdateOnNightscout,
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

async function syncDiasendDataToNigthscout() {
  if (!config.diasend.password) {
    throw Error("Diasend Password not configured");
  }
  if (!config.diasend.username) {
    throw Error("Diasend Username not configured");
  }

  const { access_token: diasendAccessToken } = await obtainDiasendAccessToken(
    config.diasend.clientId,
    config.diasend.clientSecret,
    config.diasend.username,
    config.diasend.password
  );

  // FIXME: should only happen in loop
  const dateFrom = dayjs(await getLatestCgmUpdateOnNightscout())
    .add(1, "second")
    .toDate();
  console.log(`Latest update on nightscout was ${dayjs(dateFrom).fromNow()}`);

  // using the diasend token, now fetch the patient records
  const records = await getPatientData(
    diasendAccessToken,
    // dayjs().subtract(5, "minute").toDate(),
    dateFrom,
    new Date()
  );
  console.log(records);

  // extract all CGM values first
  const cgmRecords = records
    // TODO: support non-glucose type values
    // TODO: treat calibration events differently?
    .filter((record) => record.type === "glucose")
    .map(diasendPatientRecordToNightscoutEntry);

  // send them to nightscout
  console.log(`Sending ${cgmRecords.length} records to nightscout`);
  await reportCgmToNightScout(cgmRecords);
}

// CamAPSFx uploads data to diasend every 5 minutes. (Which is also the time after which new CGM values from Dexcom will be available)
const interval = 5 * 60 * 1000;

let synchronizationTimeoutId: NodeJS.Timeout | undefined | number;
export function startSynchronization(
  {
    pollingIntervalMs,
  }: {
    pollingIntervalMs: number;
  } = { pollingIntervalMs: interval }
) {
  syncDiasendDataToNigthscout().finally(() => {
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
        void startSynchronization({ pollingIntervalMs });
      }, pollingIntervalMs);
    }
  });

  // return a function that can be used to end the loop
  return () => {
    clearTimeout(synchronizationTimeoutId);
  };
}
