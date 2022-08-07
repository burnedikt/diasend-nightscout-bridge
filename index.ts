import axios from "axios";
import config from "./config";
import { stringify } from "querystring";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import crypto from "crypto";

dayjs.extend(relativeTime);

const diasendClient = axios.create({
  baseURL: "https://api.diasend.com/1",
  headers: {
    "User-Agent": "diasend/1.13.0 (iPhone; iOS 15.5; Scale/3.00)",
  },
});

if (!config.nightscout.apiSecret) {
  throw Error(
    "Nightscout API Secret needs to be defined as an env var 'NIGHTSCOUT_API_SECRET'"
  );
}
const shasum = crypto.createHash("sha1");
shasum.update(config.nightscout.apiSecret);
const nightscoutClient = axios.create({
  baseURL: config.nightscout.url,
  headers: {
    "api-secret": shasum.digest("hex"),
  },
});

interface TokenResponse {
  access_token: string;
  expires_in: string;
  token_type: string;
}

interface PatientRecord {
  type: "glucose" | "inuslin_basal" | "insulin_bolus" | "carb";
  created_at: string;
  value: number;
  unit: "mg/dl" | "g";
  flags: { flag: number; description: string }[];
}

interface NightscoutEntry {
  type: "sgv" | "mbg" | "cal" | "etc";
  // ISO datestring
  dateString: string;
  // date in nanoseconds
  date: number;
}

type SGVDirection =
  | "NONE"
  | "DoubleUp"
  | "SingleUp"
  | "FortyFiveUp"
  | "Flat"
  | "FortyFiveDown"
  | "SingleDown"
  | "DoubleDown"
  | "NOT COMPUTABLE"
  | "RATE OUT OF RANGE";

interface NightscoutSensorGlucoseValueEntry extends NightscoutEntry {
  type: "sgv";
  // the glucose reading
  sgv: number;
  //
  direction?: SGVDirection;
  noise?: number;
  filtered?: number;
  unfiltered?: number;
  rssi?: number;
}

async function obtainDiasendAccessToken(
  clientId: string = config.diasend.clientId,
  clientSecret: string = config.diasend.clientSecret,
  username: string,
  password: string
) {
  const response = await diasendClient.post<TokenResponse>(
    "/oauth2/token",
    stringify({
      grant_type: "password",
      password,
      scope: "PATIENT DIASEND_MOBILE_DEVICE_DATA_RW",
      username,
    }),
    { auth: { password: clientSecret, username: clientId } }
  );

  return response.data;
}

const diasendIsoFormatWithoutTZ = "YYYY-MM-DDTHH:mm:ss";

async function getPatientData(
  accessToken: string,
  date_from: Date,
  date_to: Date
) {
  const response = await diasendClient.get<PatientRecord[]>("/patient/data", {
    params: {
      type: "combined",
      date_from: dayjs(date_from).format(diasendIsoFormatWithoutTZ),
      date_to: dayjs(date_to).format(diasendIsoFormatWithoutTZ),
      unit: "mg_dl",
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return response.data;
}

function cgmRecordsToNightScoutEntry(
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

async function getLatestCgmUpdateOnNightscout() {
  // get only one entry --> the newest one
  const repsonse = await nightscoutClient.get<
    NightscoutSensorGlucoseValueEntry[]
  >("/api/v1/entries/sgv", {
    params: { count: 1 },
  });

  return new Date(repsonse.data[0].date);
}

async function reportCgmToNightScout(
  values: NightscoutSensorGlucoseValueEntry[]
) {
  if (!values.length) return;
  await nightscoutClient.post("/api/v1/entries/", values);
}

async function main() {
  if (!config.diasend.password) {
    throw Error("Diasend Password not configured");
  }
  if (!config.diasend.username) {
    throw Error("Diasend Username not configured");
  }

  try {
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
      .filter((record) => record.type === "glucose")
      .map(cgmRecordsToNightScoutEntry);
    // send them to nightscout
    console.log(`Sending ${cgmRecords.length} records to nightscout`);
    await reportCgmToNightScout(cgmRecords);
    console.log("All done!");
  } catch (err) {
    console.error(err);
  }
}

const interval = 5 * 60 * 1000;

void main();
setInterval(() => {
  void main();
  console.log(`Sleeping for ${interval / 60 / 1000} minutes ...`);
}, interval);
