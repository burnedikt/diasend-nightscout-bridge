import axios, { AxiosError, AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { load } from "cheerio";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import * as logger from "loglevel";
import NodeCache from "node-cache";
import { stringify } from "querystring";
import randUserAgent from "rand-user-agent";
import { CookieJar } from "tough-cookie";
import config from "../utils/config";
import {
  DeviceData,
  PatientRecord,
  PatientRecordWithDeviceData,
  TokenResponse,
} from "./types";

dayjs.extend(relativeTime);

const tokenCache = new NodeCache({
  checkperiod: 60, // check every 60 seconds for expired items / tokens
});

// for some obscure reason, diasend deviates from the normal ISO date format by removing the timezone information
const diasendIsoFormatWithoutTZ = "YYYY-MM-DDTHH:mm:ss" as const;

const diasendClient = axios.create({
  baseURL: "https://api.diasend.com/1",
  headers: {
    "User-Agent": "diasend/1.13.0 (iPhone; iOS 15.5; Scale/3.00)",
  },
});

export async function getAccessToken(
  clientId: string,
  clientSecret: string,
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

type DiasendCGMResponse = { data: PatientRecord[]; device: DeviceData }[];

export async function getPatientData(
  accessToken: string,
  date_from: Date,
  date_to: Date
): Promise<DiasendCGMResponse> {
  logger.trace(
    `Fetching diasend patient records between ${date_from.toISOString()} and ${date_to.toISOString()}`
  );
  const response = await diasendClient.get<DiasendCGMResponse>(
    "/patient/data",
    {
      params: {
        type: "cgm",
        date_from: dayjs(date_from).format(diasendIsoFormatWithoutTZ),
        date_to: dayjs(date_to).format(diasendIsoFormatWithoutTZ),
        unit: "mg_dl",
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  return response.data;
}

// SCRAPER for website
const diasendWebsiteBaseUrl = "https://international.diasend.com/";

export async function getAuthenticatedScrapingClient({
  username,
  password,
  country = 108,
  locale = "en_US",
}: {
  username: string;
  password: string;
  country?: number;
  locale?: string;
}) {
  const client = wrapper(
    axios.create({
      baseURL: diasendWebsiteBaseUrl,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      jar: new CookieJar(),
      // use a random user agent to scracpe
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      headers: { "User-Agent": randUserAgent() as string },
    })
  );
  try {
    await client.post(
      "/diasend/includes/account/login.php",
      stringify({ country, locale, user: username, passwd: password }),
      {
        // withCredentials: true,
        // we don't want the actual redirect to the dashboard to happen (as it wouldn't have cookies set)
        maxRedirects: 0,
      }
    );
    throw new Error('Login request cannot be "successful"');
  } catch (err) {
    const redirectResponse = (err as AxiosError).response;
    const userId = redirectResponse?.headers["location"].match(
      /\/reports\/(?<userId>.*)\/summary/
    )?.groups?.userId;
    if (!userId) {
      throw new Error("Could not find userId to scrape diasend");
    }

    // remember the PHPSESSID (to authenticate future requests) --> done automatically by the cookiejar
    // and the "userId" which can be obtained from the redirect happening after login and is required to access reports etc.
    return { client, userId };
  }
}

export interface PumpSettings {
  basalProfile: [string, number][];
  insulinCarbRatioProfile: [string, number][];
  insulinSensitivityProfile: [string, number][];
  bloodGlucoseTargetLow?: number;
  bloodGlucoseTargetHigh?: number;
  insulinOnBoardDurationHours?: number;
  units?: "mg/dl" | "mmol/l";
}

export async function getPumpSettings(
  client: AxiosInstance,
  userId: string
): Promise<PumpSettings> {
  const { data } = await client.get<string>(
    `/reports/${userId}/insulin/pump-settings`
  );
  const $ = load(data);

  // find the active basal profile
  const activeBasalProfile = $("td")
    .filter((_, ele) => $(ele).text() === "Active basal program")
    .next()
    .text();
  const basalProfile: [string, number][] = (
    $("h4")
      .filter((_, e) =>
        $(e).text().startsWith(`Program: ${activeBasalProfile}`)
      )
      .next("table")
      // get all rows except for header row
      .find("tr:not(:first)")
      .map((_, row) =>
        $(row)
          // get all cells of a row
          .children("td")
          // take only the last two cells (start time and rate)
          .slice(-2)
          .map((_, cell) => $(cell).text())
      )
      .get() as [string, string][]
  ).map(([startTime, rate]) => [startTime, parseFloat(rate)]);

  // identify the carbs ratio (I:C)
  const insulinCarbRatioProfile: [string, number][] = (
    $("h3")
      .filter((_, e) => $(e).text() === "I:C ratio settings")
      .next("table")
      .find("table")
      .find("tr:not(:first)")
      .map((_, row) =>
        $(row)
          // get all cells of a row
          .children("td")
          // take only the last two cells (start time and rate)
          .slice(-2)
          .map((_, cell) => $(cell).text())
      )
      .get() as [string, string][]
  ).map(([startTime, rate]) => [startTime, parseFloat(rate)]);

  // identify the insulin sensitivity factor(s)
  const insulinSensitivityProfile: [string, number][] = (
    $("h3")
      .filter((_, e) => $(e).text() === "ISF programs")
      .next("table")
      .find("table")
      .find("tr:not(:first)")
      .map((_, row) =>
        $(row)
          // get all cells of a row
          .children("td")
          // take only the last two cells (start time and rate)
          .slice(-2)
          .map((_, cell) => $(cell).text())
      )
      .get() as [string, string][]
  ).map(([startTime, rate]) => [startTime, parseFloat(rate)]);

  // lower goal of blood glucose
  const bloodGlucoseTargetLowElement = $("td")
    .filter((_, ele) => $(ele).text() === "BG goal low")
    .next()
    .text();

  const bloodGlucoseTargetLow = bloodGlucoseTargetLowElement.length
    ? parseInt(bloodGlucoseTargetLowElement.split(" ")[0])
    : undefined;

  const units = bloodGlucoseTargetLowElement
    ? bloodGlucoseTargetLowElement.split(" ")[1].toLowerCase() === "mg/dl"
      ? "mg/dl"
      : "mmol/l"
    : undefined;

  // high goal of blood glucose
  const bloodGlucoseTargetHighElement = $("td")
    .filter((_, ele) => $(ele).text() === "BG goal high")
    .next()
    .text();
  const bloodGlucoseTargetHigh = bloodGlucoseTargetHighElement
    ? parseInt(bloodGlucoseTargetHighElement.split(" ")[0])
    : undefined;

  const iobDurationHoursElement = $("td")
    .filter((_, ele) => $(ele).text() === "Insulin-On-Board Duration")
    .next()
    .text();
  // insulin on board duration
  const iobDurationHours = iobDurationHoursElement
    ? parseInt(iobDurationHoursElement.split(" ")[0])
    : undefined;

  return {
    basalProfile,
    insulinCarbRatioProfile,
    insulinSensitivityProfile,
    bloodGlucoseTargetLow,
    bloodGlucoseTargetHigh,
    insulinOnBoardDurationHours: iobDurationHours,
    units,
  };
}

export async function fetchPatientRecords({
  diasendUsername = config.diasend.username,
  diasendPassword = config.diasend.password,
  diasendClientId = config.diasend.clientId,
  diasendClientSecret = config.diasend.clientSecret,
  dateFrom,
  dateTo,
}: {
  diasendUsername?: string;
  diasendPassword?: string;
  diasendClientId?: string;
  diasendClientSecret?: string;
  dateFrom: Date;
  dateTo: Date;
}) {
  if (!diasendUsername) {
    throw Error("Diasend Username not configured");
  }
  if (!diasendPassword) {
    throw Error("Diasend Password not configured");
  }

  const { access_token: diasendAccessToken } = await getAccessToken(
    diasendClientId,
    diasendClientSecret,
    diasendUsername,
    diasendPassword
  );

  // using the diasend token, now fetch the patient records per device
  const records = await getPatientData(diasendAccessToken, dateFrom, dateTo);
  return records.flatMap((record) =>
    record.data.map<PatientRecordWithDeviceData<PatientRecord>>((r) => ({
      ...r,
      device: record.device,
    }))
  );
}
