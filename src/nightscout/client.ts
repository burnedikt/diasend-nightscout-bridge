import { Entry, Profile, Treatment } from "./types";

export interface NightscoutClient {
  fetchTreatments: (filters?: FilterArgs<Treatment>) => Promise<Treatment[]>;
  createTreatments: (treatments: Treatment[]) => Promise<Treatment[]>;
  deleteTreatments: (filters: Partial<Treatment>) => Promise<void>;
  fetchEntries: (filters?: FilterArgs<Entry>) => Promise<Entry[]>;
  createEntries: (entries: Entry[]) => Promise<Entry[]>;
  deleteEntries: (filters: Partial<Entry>) => Promise<void>;
  fetchProfile: () => Promise<Profile>;
  updateProfile: (profile: Profile) => Promise<Profile>;
}

export type FilterArgs<T> = {
  count?: number;
  dateFrom?: Date;
  dateTo?: Date;
} & Partial<T>;
