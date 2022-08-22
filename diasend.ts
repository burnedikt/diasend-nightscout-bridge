import axios from "axios";
import config from "./config";
import { stringify } from "querystring";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import NodeCache from "node-cache";

export type GlucoseUnit = "mg/dl" | "mmol/l";

const tokenCache = new NodeCache({
  checkperiod: 60, // check every 60 seconds for expired items / tokens
});

dayjs.extend(relativeTime);

// for some obscure reason, diasend deviates from the normal ISO date format by removing the timezone information
const diasendIsoFormatWithoutTZ = "YYYY-MM-DDTHH:mm:ss";

interface TokenResponse {
  access_token: string;
  expires_in: string;
  token_type: string;
}

export interface BaseRecord {
  created_at: string;
  flags: { flag: number; description: string }[];
  device: DeviceData;
}

export interface GlucoseRecord extends BaseRecord {
  type: "glucose";
  value: number;
  unit: GlucoseUnit;
}

type YesOrNo = "yes" | "no";

export interface BolusRecord extends BaseRecord {
  type: "insulin_bolus";
  unit: "U";
  total_value: number;
  spike_value: number;
  suggested: number;
  suggestion_overriden: YesOrNo;
  suggestion_based_on_bg: YesOrNo;
  suggestion_based_on_carb: YesOrNo;
  programmed_meal?: number;
  programmed_bg_correction?: number;
}
export interface CarbRecord extends BaseRecord {
  type: "carb";
  value: string; // for some reason, carbs are not given as numbers but a string 🤷
  unit: "g";
}

export interface BasalRecord extends BaseRecord {
  type: "insulin_basal";
  unit: "U/h";
  value: number;
}

type PatientRecord = GlucoseRecord | BolusRecord | BasalRecord | CarbRecord;

interface DeviceData {
  serial: string;
  manufacturer: string;
  model: string;
}

const diasendClient = axios.create({
  baseURL: "https://api.diasend.com/1",
  headers: {
    "User-Agent": "diasend/1.13.0 (iPhone; iOS 15.5; Scale/3.00)",
  },
});

export async function obtainDiasendAccessToken(
  clientId: string = config.diasend.clientId,
  clientSecret: string = config.diasend.clientSecret,
  username: string,
  password: string,
  allowCache = true
): Promise<TokenResponse> {
  let token = tokenCache.get<TokenResponse>("token");
  if (token === undefined || !allowCache) {
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

    token = response.data;
    tokenCache.set("token", token, parseInt(token.expires_in));
  }

  return token;
}

export async function getPatientData(
  accessToken: string,
  date_from: Date,
  date_to: Date,
  unit: GlucoseUnit = "mg/dl"
): Promise<PatientRecord[]> {
  const response = await diasendClient.get<
    { data: PatientRecord[]; device: DeviceData }[]
  >("/patient/data", {
    params: {
      type: "cgm",
      date_from: dayjs(date_from).format(diasendIsoFormatWithoutTZ),
      date_to: dayjs(date_to).format(diasendIsoFormatWithoutTZ),
      unit: unit.replace("/", "_"),
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return response.data.reduce<PatientRecord[]>((records, recordsPerDevice) => {
    records.push(
      ...recordsPerDevice.data.map((r) => ({
        ...r,
        device: recordsPerDevice.device,
      }))
    );
    return records;
  }, []);
}
