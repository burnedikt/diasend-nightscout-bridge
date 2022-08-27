import { diasendGlucoseRecordToNightscoutEntry } from "../adapter";
import { DeviceData, GlucoseRecord } from "../diasend";
import {
  ManualGlucoseValueEntry,
  SensorGlucoseValueEntry,
} from "../nightscout";

const testDevice: DeviceData = {
  manufacturer: "ACME",
  serial: "1111-22123",
  model: "Test Pump",
};

describe("testing conversion of diasend patient data to nightscout entries", () => {
  const ORIGINAL_TZ = process.env.TZ;

  beforeEach(() => {
    // set the timezone explicitly to avoid any conversion issues of non-timezone aware diasend dates
    jest.resetModules();
    process.env.TZ = "Europe/Berlin";
  });

  afterAll(() => {
    // restore original timezone
    process.env.TZ = ORIGINAL_TZ;
  });

  test("continuous reading", () => {
    // given a continuous glucose reading from diasend
    const glucoseReading: GlucoseRecord = {
      type: "glucose",
      created_at: "2022-08-26T16:33:44",
      value: 232,
      unit: "mg/dl",
      flags: [
        {
          flag: 123,
          description: "Continous reading",
        },
      ],
    };
    // and some device data
    const device = testDevice;

    // when converting the reading to a nightscout entry
    const nightscoutEntry = diasendGlucoseRecordToNightscoutEntry(
      glucoseReading,
      device
    );

    // then expect it to look like this
    expect(nightscoutEntry).toStrictEqual<SensorGlucoseValueEntry>({
      date: 1661524424000,
      dateString: "2022-08-26T14:33:44.000Z",
      type: "sgv",
      app: "diasend",
      sgv: 232,
      device: "Test Pump (1111-22123)",
      direction: undefined,
    });
  });

  test("manual blood glucose measurement", () => {
    // given a manual blood glucose measurement
    const glucoseReading: GlucoseRecord = {
      type: "glucose",
      created_at: "2022-08-26T16:04:37",
      value: 178,
      unit: "mg/dl",
      flags: [
        {
          flag: 126,
          description: "Manual",
        },
      ],
    };
    // and some device data
    const device = testDevice;

    // when converting the reading to a nightscout entry
    const nightscoutEntry = diasendGlucoseRecordToNightscoutEntry(
      glucoseReading,
      device
    );

    // then expect it to look like this
    expect(nightscoutEntry).toStrictEqual<ManualGlucoseValueEntry>({
      date: 1661522677000,
      dateString: "2022-08-26T14:04:37.000Z",
      type: "mbg",
      app: "diasend",
      mbg: 178,
      device: "Test Pump (1111-22123)",
    });
  });
});
