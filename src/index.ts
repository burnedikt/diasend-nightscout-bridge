import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import * as logger from "loglevel";
import { diasendImportnightscoutApp } from "./adapter/const";
import { synchronizeGlucoseRecords } from "./adapter/glucose";
import { updateNightScoutProfileWithPumpSettings } from "./adapter/pump-settings";
import { synchronizeTreatmentRecords } from "./adapter/treatments";
import {
  fetchPatientRecords,
  getAuthenticatedScrapingClient,
  getPumpSettings,
} from "./diasend";
import { PatientRecord } from "./diasend/types";
import {
  fetchLatestSGV,
  fetchLatestTreatment,
  NightscoutClient,
  NightscoutHttpClient,
} from "./nightscout";
import { TreatmentType, treatmentTypes } from "./nightscout/types";
import config from "./utils/config";
import {
  defaultPollingInterval,
  defaultPollingIntervalPumpSettings,
} from "./utils/constants";
import { Looper } from "./utils/looper";
import { sortDatesAscending } from "./utils/time";

dayjs.extend(relativeTime);

// setup logging
logger.setDefaultLevel(config.loglevel);

interface BaseSyncDiasendArgs {
  diasendUsername?: string;
  diasendPassword?: string;
  diasendClientId?: string;
  diasendClientSecret?: string;
}

type NightscoutProfileOptions = {
  nightscoutProfileName?: string;
};

export function getNightscoutHttpClient() {
  if (!config.nightscout.apiSecret) {
    throw Error(
      "Nightscout API Secret needs to be defined as an env var 'NIGHTSCOUT_API_SECRET'"
    );
  }
  if (!config.nightscout.url) {
    throw Error(
      "Nightscout url needs to be defined as an env var 'NIGHTSCOUT_URL'"
    );
  }

  return new NightscoutHttpClient(
    config.nightscout.url,
    config.nightscout.apiSecret,
    { app: "diasend" }
  );
}

function getLatestImportDateForRecordType(
  recordType: PatientRecord["type"],
  latestImportDates: LatestImportDatesByTreatmentType
) {
  switch (recordType) {
    case "insulin_basal":
      return latestImportDates["Temp Basal"];
    case "glucose":
      return latestImportDates.SGV;
    case "carb":
      return latestImportDates["Carb Correction"];
    case "insulin_bolus":
      // insulin bolus can result in a correction or meal bolus
      return [
        latestImportDates["Meal Bolus"],
        latestImportDates["Correction Bolus"],
      ]
        .sort(sortDatesAscending)
        .at(0);
  }
}

export function startSynchronization({
  pollingIntervalMs = defaultPollingInterval,
  nightscoutClient = getNightscoutHttpClient(),
  ...diasendCredentials
}: {
  pollingIntervalMs?: number;
  nightscoutClient?: NightscoutClient;
} & BaseSyncDiasendArgs = {}) {
  const loop = new Looper(
    pollingIntervalMs,
    async () => {
      // identify lower time limit (= last known earliest record imported from diasend to nightscout)
      const latestImportDates = await fetchLatestImportDatesByTreatmentType();

      // to determine date from fetching, ignore the SGV values
      let dateFrom =
        latestImportDates["Meal Bolus"] ??
        latestImportDates["Correction Bolus"];
      // limit the time to go back to 24 hours
      const yesterday = dayjs().subtract(24, "hour").toDate();
      if (dateFrom && dateFrom < yesterday) {
        dateFrom = yesterday;
        logger.log(
          `Limiting import to start from ${dayjs(dateFrom).fromNow()}`
        );
      }
      if (!dateFrom) {
        dateFrom = yesterday;
        logger.log(
          `No previous import found on nightscout, starting to import data from ${dayjs(
            dateFrom
          ).fromNow()}`
        );
      }

      // fetch diasend records between the lower time limit and "now"
      const records = await fetchPatientRecords({
        ...diasendCredentials,
        // add 1 second to not fetch the already known data again
        dateFrom: dayjs(dateFrom).add(1, "second").toDate(),
        dateTo: new Date(),
      });

      // Filter out any events that have already been processed in the past (based on the known latest import timestamps per category)
      logger.debug(
        "Filter diasend records based on latest known record according to type:"
      );
      Object.entries(latestImportDates).forEach(([key, value]) => {
        logger.debug(`   ${key}: ${value?.toISOString() ?? "n/a"}`);
      });
      const filteredRecords = records.filter(
        (record) =>
          new Date(record.created_at) >
          (getLatestImportDateForRecordType(record.type, latestImportDates) ??
            new Date(0))
      );
      logger.debug(
        `Number of unprocessed records fetched from diasend: ${filteredRecords.length}`,
        filteredRecords
      );

      // process records depending on type and synchronize them to nightscout
      await Promise.all([
        // handle glucose records
        synchronizeGlucoseRecords(filteredRecords, {
          nightscoutClient,
        }),
        // handle insulin boli, carbs and temp basal rates
        synchronizeTreatmentRecords(filteredRecords, {
          nightscoutClient,
        }),
      ]);
    },
    ""
  ).loop();

  // return a function that can be used to end the loop
  return () => loop.stop();
}

export type SynchronizeOptions = {
  nightscoutClient: NightscoutClient;
};

export function startPumpSettingsSynchronization({
  diasendUsername,
  diasendPassword,
  pollingIntervalMs = defaultPollingIntervalPumpSettings,
  nightscoutProfileName = config.nightscout.profileName,
  nightscoutClient = getNightscoutHttpClient(),
}: {
  diasendUsername?: string;
  diasendPassword?: string;
  pollingIntervalMs?: number;
} & NightscoutProfileOptions &
  Partial<SynchronizeOptions> = {}) {
  if (!nightscoutProfileName) {
    logger.info(
      "Not synchronizing pump settings to nightscout profile since profile name is not defined"
    );
    return;
  }

  const looper = new Looper(
    pollingIntervalMs,
    async () =>
      await synchronizePumpSettings({
        diasendUsername,
        diasendPassword,
        nightscoutProfileName,
        nightscoutClient,
      }),
    "Pump Settings"
  ).loop();

  // return a function that can be used to end the loop
  return () => {
    looper.stop();
  };
}

async function synchronizePumpSettings({
  diasendUsername = config.diasend.username,
  diasendPassword = config.diasend.password,
  nightscoutProfileName = config.nightscout.profileName,
  nightscoutClient,
}: {
  diasendUsername?: string;
  diasendPassword?: string;
  pollingIntervalMs?: number;
} & NightscoutProfileOptions &
  SynchronizeOptions) {
  if (!diasendUsername) {
    throw Error("Diasend Username not configured");
  }
  if (!diasendPassword) {
    throw Error("Diasend Password not configured");
  }
  const { client, userId } = await getAuthenticatedScrapingClient({
    username: diasendUsername,
    password: diasendPassword,
  });
  const pumpSettings = await getPumpSettings(client, userId);
  const updatedNightscoutProfile = updateNightScoutProfileWithPumpSettings(
    await nightscoutClient.fetchProfile(),
    pumpSettings,
    { nightscoutProfileName }
  );
  await nightscoutClient.updateProfile(updatedNightscoutProfile);
}

type LatestImportDatesByTreatmentType = {
  [key in TreatmentType | "SGV"]: Date | undefined;
};

async function fetchLatestImportDatesByTreatmentType(
  nightscoutClient = getNightscoutHttpClient()
): Promise<LatestImportDatesByTreatmentType> {
  // check for latest import dates of all treatment types ...
  const treatmentTypesLatestImportDates = treatmentTypes
    // don't care about BG Check treatments
    .filter((tt) => tt !== "BG Check")
    .map((eventType) =>
      fetchLatestTreatment(nightscoutClient, {
        app: diasendImportnightscoutApp,
        eventType,
      }).then<[TreatmentType, Date | undefined]>((treatment) => [
        eventType,
        treatment ? new Date(treatment.created_at) : undefined,
      ])
    );
  // ... and of blood glucose value
  const sensorGlucoseValueLatestEntryDate = fetchLatestSGV(
    nightscoutClient
  ).then<["SGV", Date | undefined]>((sgv) => [
    "SGV",
    sgv ? new Date(sgv.date) : undefined,
  ]);
  const bla = await Promise.all([
    ...treatmentTypesLatestImportDates,
    sensorGlucoseValueLatestEntryDate,
  ]);

  return bla.reduce((prev, value) => ({ ...prev, [value[0]]: value[1] }), {
    ["Carb Correction"]: undefined,
    ["Correction Bolus"]: undefined,
    ["Meal Bolus"]: undefined,
    ["Temp Basal"]: undefined,
    ["BG Check"]: undefined,
    SGV: undefined,
  });
}
