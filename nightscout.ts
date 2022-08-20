import axios from "axios";
import config from "./config";
import crypto from "crypto";

interface Entry {
  type: "sgv" | "mbg" | "cal" | "etc";
  // ISO datestring
  dateString: string;
  // date in nanoseconds
  date: number;
}

export type NightscoutGlucoseUnit = "mg" | "mmol";

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

export interface SensorGlucoseValueEntry extends Entry {
  type: "sgv";
  // the glucose reading
  sgv: number;
  direction?: SGVDirection;
  noise?: number;
  filtered?: number;
  unfiltered?: number;
  rssi?: number;
  units: NightscoutGlucoseUnit; // it is highly recommended by nightscout to define units, so we'll make this required.
}

function getNightscoutClient(apiSecret = config.nightscout.apiSecret) {
  if (!apiSecret) {
    throw Error(
      "Nightscout API Secret needs to be defined as an env var 'NIGHTSCOUT_API_SECRET'"
    );
  }

  const shasum = crypto.createHash("sha1");
  shasum.update(apiSecret);
  return axios.create({
    baseURL: config.nightscout.url,
    headers: {
      "api-secret": shasum.digest("hex"),
    },
  });
}

export async function getLatestCgmUpdateOnNightscout() {
  // get only one entry --> the newest one
  const repsonse = await getNightscoutClient().get<SensorGlucoseValueEntry[]>(
    "/api/v1/entries/sgv",
    {
      params: { count: 1 },
    }
  );

  return new Date(repsonse.data[0].date);
}

export async function reportCgmToNightScout(values: SensorGlucoseValueEntry[]) {
  if (!values.length) return;
  await getNightscoutClient().post("/api/v1/entries/", values);
}
