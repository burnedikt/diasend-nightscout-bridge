import dayjs from "dayjs";
import { startSynchronization } from ".";

void startSynchronization({
  pollingIntervalMs: 5000,
  dateFrom: dayjs().subtract(600, "minutes").toDate(),
  nightscoutEntriesHandler: (entries) =>
    new Promise((resolve) => {
      console.log(entries);
      resolve(entries);
    }),
  nightscoutTreatmentsHandler: (treatments) =>
    new Promise((resolve) => {
      console.log(treatments);
      resolve(treatments);
    }),
});
