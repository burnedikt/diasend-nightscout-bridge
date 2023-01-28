import { NightscoutClient, NightscoutHttpClient } from "./client";
import { Entry, Profile, Treatment, TreatmentType } from "./types";

export {
  type TreatmentType,
  type Entry,
  type Treatment,
  type Profile,
  type NightscoutClient,
  NightscoutHttpClient,
};

export async function fetchLatestTreatment(
  nightscoutClient: NightscoutClient,
  filters: {
    eventType?: TreatmentType;
    app?: string;
    created_at?: string;
    [key: string]: string | number | undefined;
  } = {}
) {
  // get only one entry --> the newest one
  const treatments = await nightscoutClient.fetchTreatments({
    count: 1,
    ...filters,
  });

  return treatments.at(0);
}

export async function fetchLatestSGV(nightscoutClient: NightscoutClient) {
  // get only one entry --> the newest one
  const treatments = await nightscoutClient.fetchEntries({ count: 1 });
  return treatments.at(0);
}
