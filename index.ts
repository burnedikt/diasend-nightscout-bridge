import config from "./config";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  obtainDiasendAccessToken,
  getPatientData,
  GlucoseRecord,
  CarbRecord,
  BolusRecord,
  getPumpSettings,
  getAuthenticatedScrapingClient,
  PumpSettings,
} from "./diasend";
import {
  reportEntriesToNightscout,
  MealBolusTreatment,
  reportTreatmentsToNightscout,
  Treatment,
  CorrectionBolusTreatment,
  Entry,
  Profile,
  fetchProfile,
  updateProfile,
} from "./nightscout";
import {
  diasendBolusRecordToNightscoutTreatment,
  diasendGlucoseRecordToNightscoutEntry,
  diasendPumpSettingsToNightscoutProfile,
} from "./adapter";

dayjs.extend(relativeTime);

interface SyncDiasendDataToNightScoutArgs {
  diasendUsername?: string;
  diasendPassword?: string;
  diasendClientId?: string;
  diasendClientSecret?: string;
  nightscoutEntriesHandler?: (entries: Entry[]) => Promise<Entry[]>;
  nightscoutTreatmentsHandler?: (
    treatments: Treatment[]
  ) => Promise<Treatment[]>;
  dateFrom?: Date;
  dateTo?: Date;
}

async function syncDiasendDataToNightscout({
  diasendUsername = config.diasend.username,
  diasendPassword = config.diasend.password,
  diasendClientId = config.diasend.clientId,
  diasendClientSecret = config.diasend.clientSecret,
  nightscoutEntriesHandler = async (entries) =>
    await reportEntriesToNightscout(entries),
  nightscoutTreatmentsHandler = async (treatments) =>
    await reportTreatmentsToNightscout(treatments),
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

  // using the diasend token, now fetch the patient records per device
  const records = await getPatientData(diasendAccessToken, dateFrom, dateTo);
  console.log(
    "Number of diasend records since",
    dayjs(dateFrom).fromNow(),
    records.reduce<number>((count, { data }) => count + data.length, 0)
  );

  // loop over all devices
  const ret = await Promise.all(
    records.map(async ({ data: records, device }) => {
      // extract all CGM values first
      const nightscoutEntries = records
        // TODO: support non-glucose type values
        // TODO: treat calibration events differently?
        .filter<GlucoseRecord>(
          (record): record is GlucoseRecord => record.type === "glucose"
        )
        .map<Entry>((record) =>
          diasendGlucoseRecordToNightscoutEntry(record, device)
        );

      // handle insulin boli
      const nightscoutTreatments: Treatment[] = records
        .filter<CarbRecord | BolusRecord>(
          (record): record is CarbRecord | BolusRecord =>
            ["insulin_bolus", "carb"].includes(record.type)
        )
        .reduce<(MealBolusTreatment | CorrectionBolusTreatment)[]>(
          (treatments, record, _index, allRecords) => {
            // we only care about boli
            if (record.type === "carb") {
              return treatments;
            }

            const treatment = diasendBolusRecordToNightscoutTreatment(
              record,
              allRecords,
              device
            );

            return treatment ? [...treatments, treatment] : treatments;
          },
          []
        );

      console.log(`Sending ${nightscoutEntries.length} entries to nightscout`);
      console.log(
        `Sending ${nightscoutTreatments.length} treatments to nightscout`
      );
      // send them to nightscout
      const [entries, treatments] = await Promise.all([
        nightscoutEntriesHandler(nightscoutEntries),
        nightscoutTreatmentsHandler(nightscoutTreatments),
      ]);
      return { entries: entries ?? [], treatments: treatments ?? [] };
    })
  );

  // transform return value to be just one object containing all entries and treatments, device independent
  return ret.reduce<{
    entries: Entry[];
    treatments: Treatment[];
  }>(
    (combined, { entries, treatments }) => ({
      entries: combined.entries.concat(entries),
      treatments: combined.treatments.concat(treatments),
    }),
    { entries: [], treatments: [] }
  );
}

// CamAPSFx uploads data to diasend every 5 minutes. (Which is also the time after which new CGM values from Dexcom will be available)
const interval = 10 * 60 * 1000;

let synchronizationTimeoutId: NodeJS.Timeout | undefined | number;

export function startSynchronization({
  pollingIntervalMs = interval,
  dateFrom = dayjs().subtract(interval, "milliseconds").toDate(),
  ...syncArgs
}: {
  pollingIntervalMs?: number;
} & SyncDiasendDataToNightScoutArgs = {}) {
  let nextDateFrom: Date = dateFrom;
  syncDiasendDataToNightscout({ dateFrom, ...syncArgs })
    .then(({ entries, treatments }) => {
      // next run's data should be fetched where this run ended, so take a look at the records
      if (!entries?.length && !treatments?.length) {
        return;
      }
      nextDateFrom = new Date(
        entries
          .map((e) => e.date)
          .concat(treatments.map((t) => t.date))
          .sort((a, b) => b - a)[0] + 1000
      );
    })
    .finally(() => {
      // if synchronizationTimeoutId is set to 0 when we get here, don't schedule a re-run. This is the exit condition
      // and prevents the synchronization loop from continuing if the timeout is cleared while already running the sync
      if (synchronizationTimeoutId !== 0) {
        // schedule the next run
        console.log(
          `Next run will be in ${dayjs()
            .add(pollingIntervalMs, "milliseconds")
            .fromNow()}...`
        );
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

let pumpSettingsSynchronizationTimeoutId: NodeJS.Timeout | undefined | number;

export function startPumpSettingsSynchronization({
  diasendUsername = config.diasend.username,
  diasendPassword = config.diasend.password,
  // per default synchronize every 12 hours
  pollingIntervalMs = 12 * 3600 * 1000,
  nightscoutProfileName = config.nightscout.profileName,
  nightscoutPumpSettingsHandler = (pumpSettings) =>
    savePumpSettingsInNightscoutProfile(nightscoutProfileName!, pumpSettings),
}: {
  diasendUsername?: string;
  diasendPassword?: string;
  pollingIntervalMs?: number;
  nightscoutProfileName?: string;
  nightscoutPumpSettingsHandler?: (
    pumpSettings: PumpSettings
  ) => Promise<Profile>;
} = {}) {
  function pumpSynchronizationLoop() {
    if (!diasendUsername) {
      throw Error("Diasend Username not configured");
    }
    if (!diasendPassword) {
      throw Error("Diasend Password not configured");
    }

    if (!nightscoutProfileName) {
      console.info(
        "Not synchronizing pump settings to nightscout profile since profile name is not defined"
      );
      return;
    }

    getAuthenticatedScrapingClient({
      username: diasendUsername,
      password: diasendPassword,
    })
      .then(({ client, userId }) => getPumpSettings(client, userId))
      .then(nightscoutPumpSettingsHandler)
      .finally(() => {
        // restart after specified time
        // if synchronizationTimeoutId is set to 0 when we get here, don't schedule a re-run. This is the exit condition
        // and prevents the synchronization loop from continuing if the timeout is cleared while already running the sync
        if (pumpSettingsSynchronizationTimeoutId !== 0) {
          console.log(
            `Next run to synchronize pump settings will be in ${dayjs()
              .add(pollingIntervalMs, "milliseconds")
              .fromNow()}...`
          );

          setTimeout(pumpSynchronizationLoop, pollingIntervalMs);
        }
      });
  }

  void pumpSynchronizationLoop();

  // return a function that can be used to end the loop
  return () => {
    clearTimeout(pumpSettingsSynchronizationTimeoutId);
  };
}

async function savePumpSettingsInNightscoutProfile(
  nightscoutProfileName: string,
  pumpSettings: PumpSettings
): Promise<Profile> {
  const profile = await fetchProfile();

  return await updateProfile({
    ...profile,
    store: {
      ...profile.store,
      [nightscoutProfileName]:
        diasendPumpSettingsToNightscoutProfile(pumpSettings),
    },
  });
}
