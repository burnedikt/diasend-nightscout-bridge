import { FilterArgs, NightscoutClient } from "./client";
import { Entry, Profile, Treatment } from "./types";

interface BaseNightscoutCollection<T> {
  create: (
    entries: T[],
    callback: (err: unknown, entries: T[]) => void
  ) => void;
  remove: (
    filters: { find: Partial<T> },
    callback: (err: unknown, result: unknown) => void
  ) => void;
  list: (
    filters: {
      count?: number;
      find: Omit<FilterArgs<T>, "dateFrom" | "dateTo">;
    },
    callback: (err: unknown, entries: T[]) => void
  ) => void;
}
interface NightscoutProfilesCollection
  extends Omit<BaseNightscoutCollection<Profile>, "list"> {
  save: (
    profile: Profile,
    callback: (err: unknown, profile: Profile) => void
  ) => void;
  list: (
    callback: (err: unknown, profiles: Profile[]) => void,
    count: number
  ) => void;
}
type NightscoutEntriesCollection = BaseNightscoutCollection<Entry>;
type NightscoutTreatmentsCollection = BaseNightscoutCollection<Treatment>;
/**
 * An implementation of the NightscoutClient interface that directly operates on the
 * mongodb collections of nightscout, without using the REST API.
 */

export class InternalApiNightscoutClient implements NightscoutClient {
  entries: NightscoutEntriesCollection;
  treatments: NightscoutTreatmentsCollection;
  profiles: NightscoutProfilesCollection;

  constructor(
    entries: NightscoutEntriesCollection,
    treatments: NightscoutTreatmentsCollection,
    profiles: NightscoutProfilesCollection
  ) {
    this.entries = entries;
    this.treatments = treatments;
    this.profiles = profiles;
  }

  async fetchTreatments({
    dateFrom,
    dateTo,
    count,
    ...filters
  }: FilterArgs<Treatment> = {}) {
    return await new Promise<Treatment[]>((resolve, reject) =>
      this.treatments.list(
        {
          count,
          find: {
            ...filters,
            ...this.dateFromToQueryParam(dateFrom, "created_at"),
            ...this.dateToToQueryParam(dateTo, "created_at"),
          },
        },
        (err, treatments) => (err ? reject(err) : resolve(treatments))
      )
    );
  }
  async createTreatments(treatments: Treatment[]) {
    if (!treatments.length) {
      return [];
    }

    return await new Promise<Treatment[]>((resolve, reject) => {
      this.treatments.create(treatments, (err, results) =>
        err ? reject(err) : resolve(results)
      );
    });
  }
  async deleteTreatments(filters: Partial<Treatment>) {
    await new Promise<void>((resolve, reject) =>
      this.treatments.remove({ find: filters }, (err) =>
        err ? reject(err) : resolve()
      )
    );
  }
  async fetchEntries({
    dateFrom,
    dateTo,
    count,
    ...filters
  }: FilterArgs<Treatment> = {}) {
    return await new Promise<Entry[]>((resolve, reject) =>
      this.entries.list(
        {
          count,
          find: {
            ...filters,
            ...this.dateFromToQueryParam(dateFrom),
            ...this.dateToToQueryParam(dateTo),
          },
        },
        (err, entries) => (err ? reject(err) : resolve(entries))
      )
    );
  }
  async createEntries(entries: Entry[]) {
    if (!entries.length) {
      return [];
    }
    return await new Promise<Entry[]>((resolve, reject) => {
      this.entries.create(entries, (err, results) =>
        err ? reject(err) : resolve(results)
      );
    });
  }
  async deleteEntries(filters: Partial<Entry>) {
    await new Promise((resolve, reject) => {
      this.entries.remove({ find: filters }, (err, results) =>
        err ? reject(err) : resolve(results)
      );
    });
  }
  async fetchProfile() {
    return await new Promise<Profile>((resolve, reject) =>
      this.profiles.list((err, profiles) => {
        err ? reject(err) : resolve(profiles[0]);
      }, 1)
    );
  }
  async updateProfile(profile: Profile) {
    return await new Promise<Profile>((resolve, reject) =>
      this.profiles.save(profile, (err, _profile) => {
        err ? reject(err) : resolve(_profile);
      })
    );
  }

  dateFromToQueryParam(
    dateFrom: Date | undefined,
    dateFieldName = "dateString"
  ) {
    return dateFrom
      ? { [dateFieldName]: { $gte: dateFrom.toISOString() } }
      : {};
  }

  dateToToQueryParam(dateTo: Date | undefined, dateFieldName = "dateString") {
    return dateTo ? { [dateFieldName]: { $lte: dateTo.toISOString() } } : {};
  }
}
