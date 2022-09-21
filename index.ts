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
  previousRecords?: { [deviceSerial: string]: PatientRecord[] };
}

export function identifyTreatments(
  records: PatientRecord[],
  device: DeviceData
) {
  const unprocessedRecords: (CarbRecord | BolusRecord)[] = [];
  const treatments = records
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
      try {
        const treatment = diasendRecordToNightscoutTreatment(
          record,
          allRecords,
          device
        );

        if (treatment) {
          treatments.push(treatment);
        }
      } catch (e) {
        // if an error happened, this means, we'll need to remember the record and try to resolve it in the next run
        unprocessedRecords.push(record);
      }

      return treatments;
    }, []);

  return { treatments, unprocessedRecords };
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
  previousRecords = {},
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
    `Number of diasend records since ${dayjs(dateFrom).from(
      dateTo
    )} (${dateFrom.toISOString()} - ${dateTo.toISOString()}): `,
    records.reduce<number>((count, { data }) => count + data.length, 0)
  );

  // loop over all devices
  const ret = await Promise.all(
    records.map(async ({ data: records, device }) => {
      // include any unprocessed records from previous runs
      if (device.serial in previousRecords) {
        records.unshift(...previousRecords[device.serial]);
      }
      // extract all CGM values first
      const nightscoutEntries: Entry[] = records
        // TODO: support non-glucose type values
        // TODO: treat calibration events differently?
        .filter<GlucoseRecord>(
          (record): record is GlucoseRecord => record.type === "glucose"
        )
        .map<Entry>((record) =>
          diasendGlucoseRecordToNightscoutEntry(record, device)
        );

      // handle insulin boli and carbs
      const { treatments: nightscoutTreatments, unprocessedRecords } =
        identifyTreatments(records, device);

      // remember any unprocessed records for the next run

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
      console.log(
        `Updating basal profile based on ${basalRecords.length} records`
      );
      // send them to nightscout
      const [entries, treatments, profile] = await Promise.all([
        nightscoutEntriesHandler(nightscoutEntries),
        nightscoutTreatmentsHandler(nightscoutTreatments),
        nightscoutProfileHandler(updatedProfile),
      ]);
      return {
        entries: entries ?? [],
        treatments: treatments ?? [],
        profile,
        latestRecordDate: dayjs(
          (
            records
              // sort records by date (descending)
              .sort((r1, r2) =>
                dayjs(r2.created_at).diff(dayjs(r1.created_at))
              )[0] ?? { created_at: dateTo }
          ).created_at
        ).toDate(),
        unprocessedRecords,
        device,
      };
    })
  );

  // transform return value to be just one object containing all entries and treatments, device independent
  return ret.reduce<{
    entries: Entry[];
    treatments: Treatment[];
    profile?: Profile;
    latestRecordDate: Date;
    unprocessedRecords: { [deviceSerial: string]: PatientRecord[] };
  }>(
    (
      combined,
      {
        entries,
        treatments,
        profile,
        latestRecordDate,
        unprocessedRecords,
        device,
      }
    ) => ({
      entries: combined.entries.concat(entries),
      treatments: combined.treatments.concat(treatments),
      profile: profile,
      latestRecordDate:
        combined.latestRecordDate < latestRecordDate
          ? latestRecordDate
          : combined.latestRecordDate,
      unprocessedRecords: {
        ...combined.unprocessedRecords,
        [device.serial]: unprocessedRecords,
      },
    }),
    {
      entries: [],
      treatments: [],
      latestRecordDate: new Date(0),
      unprocessedRecords: {},
    }
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
    async ({ dateTo, ...args } = {}) => {
      const { latestRecordDate, unprocessedRecords } =
        await syncDiasendDataToNightscout({
          dateTo,
          ...args,
        });
      // next run's data should be fetched where this run ended, so take a look at the records
      console.log(
        `Scheduling ${Object.values(unprocessedRecords).reduce(
          (sum, records) => sum + records.length,
          0
        )} records for processing in next run`
      );
      // remove the dateTo option
      return {
        ...args,
        dateFrom: dayjs(latestRecordDate).add(1, "second").toDate(),
        previousRecords: unprocessedRecords,
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
