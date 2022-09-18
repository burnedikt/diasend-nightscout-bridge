import { updateBasalProfile } from "../adapter";
import { BasalRecord } from "../diasend";
import { TimeBasedValue, updateProfile } from "../nightscout";

describe("testing conversion of diasend basal records to nightscout basal profile", () => {
  test("conversion", () => {
    // Given a bunch of basal records from diasend
    // and an existing basal profile within nightscout
    const basalRecords: BasalRecord[] = [
      {
        type: "insulin_basal",
        created_at: "2022-09-16T07:25:12",
        value: 1.5,
        unit: "U/h",
        flags: [],
      },
      {
        type: "insulin_basal",
        created_at: "2022-09-16T15:00:00",
        value: 1.0,
        unit: "U/h",
        flags: [],
      },
    ];
    const existingBasalProfile: TimeBasedValue[] = [
      { value: 1.0, time: "00:00", timeAsSeconds: 0 },
      { value: 1.2, time: "06:00", timeAsSeconds: 21600 },
      { value: 0.8, time: "12:00", timeAsSeconds: 43200 },
      { value: 0.6, time: "17:00", timeAsSeconds: 61200 },
    ];

    // when updating the nightscout profile
    const updatedBasalProfile = updateBasalProfile(
      existingBasalProfile,
      basalRecords
    );

    // then expect historical data to be preserved but future data to be unknown (until the next update)
    expect(updatedBasalProfile).toStrictEqual([
      { value: 1, time: "00:00", timeAsSeconds: 0 },
      { value: 1.2, time: "06:00", timeAsSeconds: 21600 },
      { value: 1.5, time: "07:25:12", timeAsSeconds: 26712 },
      { value: 1.0, time: "15:00", timeAsSeconds: 54000 },
    ]);
  });
});
