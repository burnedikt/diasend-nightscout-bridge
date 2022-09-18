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
  BasalRecord,
  BaseRecord,
  PatientRecord,
  DeviceData,
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
  TimeBasedValue,
  ProfileConfig,
  CarbCorrectionTreatment,
} from "./nightscout";
import {
  diasendRecordToNightscoutTreatment,
  diasendGlucoseRecordToNightscoutEntry,
  diasendPumpSettingsToNightscoutProfile,
  updateBasalProfile,
} from "./adapter";

dayjs.extend(relativeTime);

interface SyncDiasendDataToNightScoutArgs {
  diasendUsername?: string;
  diasendPassword?: string;
  diasendClientId?: string;
  diasendClientSecret?: string;
  nightscoutProfileName?: string;
  nightscoutEntriesHandler?: (entries: Entry[]) => Promise<Entry[]>;
  nightscoutTreatmentsHandler?: (
    treatments: Treatment[]
  ) => Promise<Treatment[]>;
  dateFrom?: Date;
  dateTo?: Date;
}

export function identifyTreatments(
  records: PatientRecord[],
  device: DeviceData
) {
  return records
    .filter<CarbRecord | BolusRecord>(
      (record): record is CarbRecord | BolusRecord =>
        ["insulin_bolus", "carb"].includes(record.type)
    )
    .reduce<
      (
        | MealBolusTreatment
        | CorrectionBolusTreatment
        | CarbCorrectionTreatment
      )[]
    >((treatments, record, _index, allRecords) => {
      const treatment = diasendRecordToNightscoutTreatment(
        record,
        allRecords,
        device
      );

      if (treatment) {
        treatments.push(treatment);
      }

      return treatments;
    }, []);
}

async function syncDiasendDataToNightscout({
  diasendUsername = config.diasend.username,
  diasendPassword = config.diasend.password,
  diasendClientId = config.diasend.clientId,
  diasendClientSecret = config.diasend.clientSecret,
  nightscoutEntriesHandler = (entries) => reportEntriesToNightscout(entries),
  nightscoutTreatmentsHandler = (treatments) =>
    reportTreatmentsToNightscout(treatments),
  nightscoutProfileName = config.nightscout.profileName!,
  nightscoutProfileHandler = (profile) => updateProfile(profile),
  nightscoutProfileLoader = () => fetchProfile(),
  dateFrom = dayjs().subtract(10, "minutes").toDate(),
  dateTo = new Date(),
}: SyncDiasendDataToNightScoutArgs & NightscoutProfileOptions) {
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

      // handle insulin boli and carbs
      const nightscoutTreatments: Treatment[] = identifyTreatments(
        records,
        device
      );

      // handle basal rates
      const existingProfile = await nightscoutProfileLoader();
      const existingProfileConfig: ProfileConfig =
        nightscoutProfileName in existingProfile.store
          ? existingProfile.store[nightscoutProfileName]
          : existingProfile.store[existingProfile.defaultProfile];
      const basalRecords = records.filter<BasalRecord>(
        (record): record is BasalRecord => record.type === "insulin_basal"
      );
      const updatedBasalProfile = updateBasalProfile(
        existingProfileConfig.basal || [],
        basalRecords
      );
      const updatedProfile: Profile = {
        ...existingProfile,
        store: {
          ...existingProfile.store,
          [nightscoutProfileName]: {
            ...existingProfileConfig,
            basal: updatedBasalProfile,
          },
        },
      };

      console.log(`Sending ${nightscoutEntries.length} entries to nightscout`);
      console.log(
        `Sending ${nightscoutTreatments.length} treatments to nightscout`
      );
      // send them to nightscout
      const [entries, treatments, profile] = await Promise.all([
        nightscoutEntriesHandler(nightscoutEntries),
        nightscoutTreatmentsHandler(nightscoutTreatments),
        nightscoutProfileHandler(updatedProfile),
      ]);
      return { entries: entries ?? [], treatments: treatments ?? [], profile };
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
} & SyncDiasendDataToNightScoutArgs &
  NightscoutProfileOptions = {}) {
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

type NightscoutProfileOptions = {
  nightscoutProfileName?: string;
  nightscoutProfileLoader?: () => Promise<Profile>;
  nightscoutProfileHandler?: (profile: Profile) => Promise<Profile>;
};

export function startPumpSettingsSynchronization({
  diasendUsername = config.diasend.username,
  diasendPassword = config.diasend.password,
  // per default synchronize every 12 hours
  pollingIntervalMs = 12 * 3600 * 1000,
  nightscoutProfileName = config.nightscout.profileName,
  nightscoutProfileLoader = async () => await fetchProfile(),
  nightscoutProfileHandler = async (profile: Profile) =>
    await updateProfile(profile),
  importBasalRate = true,
}: {
  diasendUsername?: string;
  diasendPassword?: string;
  pollingIntervalMs?: number;
  importBasalRate?: boolean;
} & NightscoutProfileOptions = {}) {
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
      .then(async (pumpSettings) =>
        updateNightScoutProfileWithPumpSettings(
          await nightscoutProfileLoader(),
          pumpSettings,
          { importBasalRate, nightscoutProfileName }
        )
      )
      .then(nightscoutProfileHandler)
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

function updateNightScoutProfileWithPumpSettings(
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
