import { startPumpSettingsSynchronization, startSynchronization } from "..";

startSynchronization({ pollingIntervalMs: 1 * 60 * 1000 });
startPumpSettingsSynchronization();
