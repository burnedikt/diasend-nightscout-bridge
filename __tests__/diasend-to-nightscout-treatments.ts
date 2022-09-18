import { identifyTreatments } from "../index";
import { diasendRecordToNightscoutTreatment } from "../adapter";
import { BolusRecord, CarbRecord, DeviceData, PatientRecord } from "../diasend";
import {
  CarbCorrectionTreatment,
  CorrectionBolusTreatment,
  MealBolusTreatment,
} from "../nightscout";

const testDevice: DeviceData = {
  manufacturer: "ACME",
  serial: "1111-22123",
  model: "Test Pump",
};

describe("testing conversion of diasend patient data to nightscout treatments", () => {
  test("meal bolus + carbs", () => {
    // given a meal bolus and matching carb record
    const mealBolusRecord: BolusRecord = {
      type: "insulin_bolus",
      created_at: "2022-08-26T18:20:27",
      unit: "U",
      total_value: 0.7,
      spike_value: 0.7,
      suggested: 0.7,
      suggestion_overridden: "no",
      suggestion_based_on_bg: "no",
      suggestion_based_on_carb: "yes",
      programmed_meal: 0.7,
      flags: [
        {
          flag: 1035,
          description: "Bolus type ezcarb",
        },
      ],
    };
    const carbRecord: CarbRecord = {
      type: "carb",
      created_at: "2022-08-26T18:21:05",
      value: "18",
      unit: "g",
      flags: [],
    };
    // and some device data
    const device = testDevice;

    // when converting the reading to a nightscout entry
    const nightscoutTreatment = diasendRecordToNightscoutTreatment(
      mealBolusRecord,
      [mealBolusRecord, carbRecord],
      device
    );

    // then expect it to look like this
    expect(nightscoutTreatment).toStrictEqual<MealBolusTreatment>({
      date: 1661530827000,
      carbs: 18,
      eventType: "Meal Bolus",
      insulin: 0.7,
      device: "Test Pump (1111-22123)",
      app: "diasend",
      notes: undefined,
    });
  });

  test("meal bolus with correction", () => {
    // given a correction bolus with a meal bolus and matching carbs
    const bolusRecord: BolusRecord = {
      type: "insulin_bolus",
      created_at: "2022-08-25T11:28:55",
      unit: "U",
      total_value: 0.3,
      spike_value: 0.3,
      suggested: 0.3,
      suggestion_overridden: "no",
      suggestion_based_on_bg: "yes",
      suggestion_based_on_carb: "yes",
      programmed_meal: 0.4,
      programmed_bg_correction: -0.1,
      flags: [
        {
          flag: 1034,
          description: "Bolus type ezbg",
        },
        {
          flag: 1035,
          description: "Bolus type ezcarb",
        },
      ],
    };
    const carbRecord: CarbRecord = {
      type: "carb",
      created_at: "2022-08-25T11:29:31",
      value: "11",
      unit: "g",
      flags: [],
    };
    // and some device data
    const device = testDevice;

    // when converting the reading to a nightscout entry
    const nightscoutTreatment = diasendRecordToNightscoutTreatment(
      bolusRecord,
      [bolusRecord, carbRecord],
      device
    );

    // then expect it to look like this
    expect(nightscoutTreatment).toStrictEqual<MealBolusTreatment>({
      date: 1661419735000,
      carbs: 11,
      eventType: "Meal Bolus",
      insulin: 0.3,
      device: "Test Pump (1111-22123)",
      app: "diasend",
      notes: "Correction: -0.1",
    });
  });

  test("meal bolus without maching carbs", () => {
    // given a meal bolus without matching carbs
    const bolusRecord: BolusRecord = {
      type: "insulin_bolus",
      created_at: "2022-08-25T11:28:55",
      unit: "U",
      total_value: 0.3,
      spike_value: 0.3,
      suggested: 0.3,
      suggestion_overridden: "no",
      suggestion_based_on_bg: "yes",
      suggestion_based_on_carb: "yes",
      programmed_meal: 0.4,
      programmed_bg_correction: -0.1,
      flags: [
        {
          flag: 1034,
          description: "Bolus type ezbg",
        },
        {
          flag: 1035,
          description: "Bolus type ezcarb",
        },
      ],
    };
    // and some device data
    const device = testDevice;

    // when converting the reading to a nightscout entry
    const nightscoutTreatment = diasendRecordToNightscoutTreatment(
      bolusRecord,
      [bolusRecord],
      device
    );

    // then expect to still have a bolus and note that the carbs are missing
    expect(nightscoutTreatment).toStrictEqual<MealBolusTreatment>({
      date: 1661419735000,
      carbs: undefined,
      eventType: "Meal Bolus",
      insulin: 0.3,
      device: "Test Pump (1111-22123)",
      app: "diasend",
      notes: "Carbs unknown!, Correction: -0.1",
    });
  });

  test("correction bolus", () => {
    // given a correction-only bolus
    const bolusRecord: BolusRecord = {
      type: "insulin_bolus",
      created_at: "2022-08-25T15:42:11",
      unit: "U",
      total_value: 0.2,
      spike_value: 0.2,
      suggested: 0.2,
      suggestion_overridden: "no",
      suggestion_based_on_bg: "yes",
      suggestion_based_on_carb: "no",
      programmed_bg_correction: 0.2,
      flags: [
        {
          flag: 1034,
          description: "Bolus type ezbg",
        },
      ],
    };
    // and some device data
    const device = testDevice;

    // when converting the reading to a nightscout entry
    const nightscoutTreatment = diasendRecordToNightscoutTreatment(
      bolusRecord,
      [bolusRecord],
      device
    );

    // then expect it to look like this
    expect(nightscoutTreatment).toStrictEqual<CorrectionBolusTreatment>({
      date: 1661434931000,
      eventType: "Correction Bolus",
      insulin: 0.2,
      device: "Test Pump (1111-22123)",
      app: "diasend",
    });
  });

  test("convert hypoglycaemia treatment", () => {
    // given a hypoglycaemia treatment (which is essentially: Just carbs without any bolus)
    const records: CarbRecord[] = [
      {
        type: "carb",
        created_at: "2022-09-18T13:50:40",
        value: "5",
        unit: "g",
        flags: [],
      },
    ];

    // When passing through the converter
    const treatment = diasendRecordToNightscoutTreatment(
      records[0],
      records,
      testDevice
    );

    // Then expect to obtain a hypo treatment
    expect(treatment).toStrictEqual<CarbCorrectionTreatment>({
      date: 1663501840000,
      eventType: "Carb Correction",
      carbs: 5,
      device: "Test Pump (1111-22123)",
      app: "diasend",
    });
  });

  test("detect hypoglycaemia treatment with confusing meal bolus", () => {
    // given a hypoglycaemia treatment (which is essentially: Just carbs without any bolus)
    const records: PatientRecord[] = [
      {
        type: "glucose",
        created_at: "2022-09-18T13:49:30",
        value: 61,
        unit: "mg/dl",
        flags: [
          {
            flag: 123,
            description: "Continous reading",
          },
        ],
      },
      {
        type: "carb",
        created_at: "2022-09-18T13:50:40",
        value: "7",
        unit: "g",
        flags: [],
      },
      {
        type: "glucose",
        created_at: "2022-09-18T13:54:29",
        value: 56,
        unit: "mg/dl",
        flags: [
          {
            flag: 123,
            description: "Continous reading",
          },
        ],
      },
      // want to have a bolus here as well to ensure it's not mixed up with the hypo
      {
        type: "insulin_bolus",
        created_at: "2022-09-18T14:08:38",
        unit: "U",
        total_value: 0.5,
        spike_value: 0.5,
        suggested: 0.5,
        suggestion_overridden: "no",
        suggestion_based_on_bg: "no",
        suggestion_based_on_carb: "yes",
        programmed_meal: 0.5,
        flags: [
          {
            flag: 1035,
            description: "Bolus type ezcarb",
          },
        ],
      },
      {
        type: "carb",
        created_at: "2022-09-18T14:09:11",
        value: "11",
        unit: "g",
        flags: [],
      },
    ];

    // When passing through the converter
    const treatments = identifyTreatments(records, testDevice);

    // Then expect to obtain a hypo treatment and a meal bolus
    expect(treatments).toHaveLength(2);
    expect(treatments[0].eventType).toBe("Carb Correction");
    expect((treatments[0] as CarbCorrectionTreatment).carbs).toBe(7);
    expect(treatments[1].eventType).toBe("Meal Bolus");
    expect((treatments[1] as MealBolusTreatment).carbs).toBe(11);
    expect((treatments[1] as MealBolusTreatment).insulin).toBe(0.5);
  });
});
