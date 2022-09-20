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
  BasalRecord,
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
  ProfileConfig,
  CarbCorrectionTreatment,
} from "./nightscout";
import {
  diasendRecordToNightscoutTreatment,
  diasendGlucoseRecordToNightscoutEntry,
  updateBasalProfile,
  updateNightScoutProfileWithPumpSettings,
} from "./adapter";
import { Looper } from "./Looper";

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
    profiles: Profile[];
  }>(
    (combined, { entries, treatments, profile }) => ({
      entries: combined.entries.concat(entries),
      treatments: combined.treatments.concat(treatments),
      profiles: combined.profiles.concat(profile),
    }),
    { entries: [], treatments: [], profiles: [] }
  );
}

// CamAPSFx uploads data to diasend every 5 minutes. (Which is also the time after which new CGM values from Dexcom will be available)
const interval = 10 * 60 * 1000;

export function startSynchronization({
  pollingIntervalMs = interval,
  dateFrom = dayjs().subtract(interval, "milliseconds").toDate(),
  ...syncArgs
}: {
  pollingIntervalMs?: number;
} & SyncDiasendDataToNightScoutArgs &
  NightscoutProfileOptions = {}) {
  const looper = new Looper<
    SyncDiasendDataToNightScoutArgs & NightscoutProfileOptions
  >(
    pollingIntervalMs,
    async (args) => {
      const { entries, treatments } = await syncDiasendDataToNightscout({
        ...args,
      });
      // next run's data should be fetched where this run ended, so take a look at the records
      if (!entries?.length && !treatments?.length) {
        return { ...args };
      }
      return {
        ...args,
        dateFrom: new Date(
          entries
            .map((e) => e.date)
            .concat(treatments.map((t) => t.date))
            .sort((a, b) => b - a)[0] + 1000
        ),
      };
    },
    "Entries & Treatments"
  ).loop({ dateFrom, ...syncArgs });

  // return a function that can be used to end the loop
  return () => {
    looper.stop();
  };
}

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

  const looper = new Looper(
    pollingIntervalMs,
    async () => {
      const { client, userId } = await getAuthenticatedScrapingClient({
        username: diasendUsername,
        password: diasendPassword,
      });
      const pumpSettings = await getPumpSettings(client, userId);
      const updatedNightscoutProfile = updateNightScoutProfileWithPumpSettings(
        await nightscoutProfileLoader(),
        pumpSettings,
        { importBasalRate, nightscoutProfileName }
      );
      await nightscoutProfileHandler(updatedNightscoutProfile);
    },
    "Pump Settings"
  ).loop();

  // return a function that can be used to end the loop
  return () => {
    looper.stop();
  };
}
