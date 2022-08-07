import axios from "axios";
import config from "./config";
import crypto from "crypto";

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

export interface NightscoutSensorGlucoseValueEntry extends NightscoutEntry {
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

export async function getLatestCgmUpdateOnNightscout() {
  // get only one entry --> the newest one
  const repsonse = await nightscoutClient.get<
    NightscoutSensorGlucoseValueEntry[]
  >("/api/v1/entries/sgv", {
    params: { count: 1 },
  });

  return new Date(repsonse.data[0].date);
}

export async function reportCgmToNightScout(
  values: NightscoutSensorGlucoseValueEntry[]
) {
  if (!values.length) return;
  await nightscoutClient.post("/api/v1/entries/", values);
}
