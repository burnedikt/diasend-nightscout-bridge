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

export interface PatientRecord {
  type: "glucose" | "inuslin_basal" | "insulin_bolus" | "carb";
  created_at: string;
  value: number;
  unit: "g" | GlucoseUnit;
  flags: { flag: number; description: string }[];
}

export interface PatientGlucoseRecord extends PatientRecord {
  type: "glucose";
  unit: GlucoseUnit;
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
) {
  const response = await diasendClient.get<PatientRecord[]>("/patient/data", {
    params: {
      type: "combined",
      date_from: dayjs(date_from).format(diasendIsoFormatWithoutTZ),
      date_to: dayjs(date_to).format(diasendIsoFormatWithoutTZ),
      unit,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return response.data;
}
