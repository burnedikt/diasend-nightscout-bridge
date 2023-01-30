import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import { FilterArgs, NightscoutClient } from "./client";
import { Entry, Profile, Treatment } from "./types";

function getNightscoutAxiosInstance(nightscoutUrl: string, apiSecret: string) {
  const shasum = crypto.createHash("sha1");
  shasum.update(apiSecret);
  return axios.create({
    baseURL: nightscoutUrl,
    headers: {
      "api-secret": shasum.digest("hex"),
    },
  });
}
export class NightscoutHttpClient implements NightscoutClient {
  httpClient: AxiosInstance;
  defaultFilterOptions: Partial<Treatment & Entry>;

  constructor(
    nightscoutUrl: string,
    accessToken: string,
    defaultFilterOptions: Partial<Treatment & Entry> = {}
  ) {
    this.httpClient = getNightscoutAxiosInstance(
      new URL("/api/v1", nightscoutUrl).toString(),
      accessToken
    );
    this.defaultFilterOptions = defaultFilterOptions;
  }

  filtersToQueryParams(filters: FilterArgs<Treatment | Entry>) {
    return Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [`find[${key}]`, value])
    );
  }

  dateFromToQueryParam(
    dateFrom: Date | undefined,
    dateFieldName = "dateString"
  ) {
    return dateFrom
      ? { [`find[${dateFieldName}][$gte]`]: dateFrom.toISOString() }
      : {};
  }

  dateToToQueryParam(dateTo: Date | undefined, dateFieldName = "dateString") {
    return dateTo
      ? { [`find[${dateFieldName}][$lte]`]: dateTo.toISOString() }
      : {};
  }

  async fetchTreatments({
    count,
    dateFrom,
    dateTo,
    ...filters
  }: FilterArgs<Treatment> = {}) {
    return (
      await this.httpClient.get<Treatment[]>("/treatments/", {
        params: {
          count,
          ...this.filtersToQueryParams(filters),
          ...this.dateFromToQueryParam(dateFrom, "created_at"),
          ...this.dateToToQueryParam(dateTo, "created_at"),
        },
      })
    ).data;
  }

  async createTreatments(treatments: Treatment[]) {
    if (!treatments.length) return [];
    const response = await this.httpClient.post<Treatment[]>(
      "/treatments/",
      treatments
    );
    return response.data;
  }

  async deleteTreatments(filters: Partial<Treatment>) {
    await this.httpClient.delete<Entry[]>("/treatments/", {
      params: this.filtersToQueryParams(filters),
    });
  }

  async fetchEntries({
    count,
    dateFrom,
    dateTo,
    ...filters
  }: FilterArgs<Entry> = {}) {
    return (
      await this.httpClient.get<Entry[]>("/entries/", {
        params: {
          count,
          ...this.filtersToQueryParams(filters),
          ...this.dateFromToQueryParam(dateFrom),
          ...this.dateToToQueryParam(dateTo),
        },
      })
    ).data;
  }

  async createEntries(entries: Entry[]) {
    if (!entries.length) return [];
    const response = await this.httpClient.post<Entry[]>("/entries/", entries);
    return response.data;
  }

  async deleteEntries(filters: Partial<Entry>) {
    await this.httpClient.delete<Entry[]>("/entries/", {
      params: this.filtersToQueryParams(filters),
    });
  }

  async fetchProfile() {
    // active profile is always first of profiles
    return (await this.httpClient.get<Profile[]>("/profile")).data[0];
  }

  async updateProfile(profile: Profile) {
    return (await this.httpClient.put<Profile>("/profile", profile)).data;
  }
}
