import dayjs from "dayjs";
import { startSynchronization } from ".";

void startSynchronization({
  pollingIntervalMs: 5000,
  dateFrom: dayjs().subtract(10, "minutes").toDate(),
  nightscoutEntriesHandler: (entries) =>
    new Promise((resolve) => {
      console.log(entries);
      resolve();
    }),
});
