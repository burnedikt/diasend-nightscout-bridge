import {
  BasalRecord,
  BolusRecord,
  CarbRecord,
  PatientRecord,
  PatientRecordWithDeviceData,
} from "../diasend/types";
import { Treatment } from "../nightscout";
import {
  CarbCorrectionTreatment,
  CorrectionBolusTreatment,
  MealBolusTreatment,
  TempBasalTreatment,
} from "../nightscout/types";
import { testDeviceData } from "../__mocks__/shared";
import {
  deduplicateTreatments,
  diasendRecordToNightscoutTreatment,
  identifyTreatments,
  mergeBolusAndCarbTreatments,
} from "./treatments";

const testDevice = testDeviceData;
const testApp = "diasend";

describe("treatments", () => {
  test("detects meal bolus", () => {
    // given a meal bolus
    const mealBolusRecord: PatientRecordWithDeviceData<BolusRecord> = {
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
      device: testDevice,
    };

    // when converting the reading to a nightscout entry
    const nightscoutTreatment =
      diasendRecordToNightscoutTreatment(mealBolusRecord);

    // then expect it to look like this
    expect(nightscoutTreatment).toEqual<MealBolusTreatment>({
      created_at: "2022-08-26T16:20:27.000Z",
      carbs: undefined,
      eventType: "Meal Bolus",
      insulin: 0.7,
      device: "Test Pump (1234567890)",
      app: "diasend",
      notes: undefined,
    });
  });

  test("detects meal bolus with correction", () => {
    // given a meal bolus also correcting for a high blood glucose
    const bolusRecord: PatientRecordWithDeviceData<BolusRecord> = {
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
      device: testDevice,
    };

    // when converting the reading to a nightscout entry
    const nightscoutTreatment = diasendRecordToNightscoutTreatment(bolusRecord);

    // then expect it to look like this
    expect(nightscoutTreatment).toEqual<MealBolusTreatment>({
      carbs: undefined,
      created_at: "2022-08-25T09:28:55.000Z",
      device: "Test Pump (1234567890)",
      eventType: "Meal Bolus",
      insulin: 0.3,
      app: "diasend",
      notes: "Correction: -0.1",
    });
  });

  test("detects correction bolus", () => {
    // given a correction-only bolus
    const bolusRecord: PatientRecordWithDeviceData<BolusRecord> = {
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
      device: testDevice,
    };

    // when converting the reading to a nightscout entry
    const nightscoutTreatment = diasendRecordToNightscoutTreatment(bolusRecord);

    // then expect it to look like this
    expect(nightscoutTreatment).toEqual<CorrectionBolusTreatment>({
      created_at: "2022-08-25T13:42:11.000Z",
      eventType: "Correction Bolus",
      insulin: 0.2,
      device: "Test Pump (1234567890)",
      app: "diasend",
    });
  });

  test("detects hypoglycaemia treatment / carb correction", () => {
    // given a hypoglycaemia treatment (which is essentially: Just carbs without any bolus)
    const records: PatientRecordWithDeviceData<CarbRecord>[] = [
      {
        type: "carb",
        created_at: "2022-09-18T13:50:40",
        value: "5",
        unit: "g",
        flags: [],
        device: testDevice,
      },
    ];

    // When passing through the converter
    const treatment = diasendRecordToNightscoutTreatment(records[0]);

    // Then expect to obtain a hypo treatment
    expect(treatment).toEqual<CarbCorrectionTreatment>({
      created_at: "2022-09-18T11:50:40.000Z",
      eventType: "Carb Correction",
      carbs: 5,
      device: "Test Pump (1234567890)",
      app: "diasend",
    });
  });

  test("detect hypoglycaemia treatment with confusing meal bolus", () => {
    // given a hypoglycaemia treatment (which is essentially: Just carbs without any bolus)
    const records: PatientRecordWithDeviceData<PatientRecord>[] = [
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
        device: testDevice,
      },
      {
        type: "carb",
        created_at: "2022-09-18T13:50:40",
        value: "7",
        unit: "g",
        flags: [],
        device: testDevice,
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
        device: testDevice,
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
        device: testDevice,
      },
      {
        type: "carb",
        created_at: "2022-09-18T14:09:11",
        value: "11",
        unit: "g",
        flags: [],
        device: testDevice,
      },
    ];

    // When passing through the converter
    const treatments = identifyTreatments(records);

    // Then expect to obtain two carb corrections and a meal bolus (without carbs yet)
    expect(treatments).toHaveLength(3);
    expect(treatments[0].eventType).toBe("Carb Correction");
    expect((treatments[0] as CarbCorrectionTreatment).carbs).toBe(7);
    expect(treatments[1].eventType).toBe("Meal Bolus");
    expect((treatments[1] as MealBolusTreatment).insulin).toBe(0.5);
    expect((treatments[1] as MealBolusTreatment).carbs).toBe(undefined);
    expect(treatments[2].eventType).toBe("Carb Correction");
    expect((treatments[2] as CarbCorrectionTreatment).carbs).toBe(11);
  });

  test("parses carb records and bolui", () => {
    // Given a meal bolus where the insulin_bolus event comes prior to the matching carbs and there's a preceeding carb correction
    const records: PatientRecordWithDeviceData<PatientRecord>[] = [
      {
        type: "carb",
        created_at: "2022-11-05T13:28:00",
        value: "10",
        unit: "g",
        flags: [],
        device: testDevice,
      },
      {
        type: "carb",
        created_at: "2022-11-05T13:28:55",
        value: "5",
        unit: "g",
        flags: [],
        device: testDevice,
      },
      {
        type: "insulin_bolus",
        created_at: "2022-11-05T13:28:58",
        unit: "U",
        total_value: 0.1,
        spike_value: 0.1,
        suggested: 0.1,
        suggestion_overridden: "no",
        suggestion_based_on_bg: "no",
        suggestion_based_on_carb: "yes",
        programmed_meal: 0.1,
        flags: [
          {
            flag: 1035,
            description: "Bolus type ezcarb",
          },
        ],
        device: testDevice,
      },
    ];

    // When identifying the treatments
    const treatments = identifyTreatments(records);

    // Then expect to get two carb records and one meal bolus
    expect(treatments).toHaveLength(3);
    expect((treatments[0] as CarbCorrectionTreatment).carbs).toBe(10);
    expect((treatments[1] as CarbCorrectionTreatment).carbs).toBe(5);
    // the bolus's carbs should not be known yet and will be identifed in the next step
    expect((treatments[2] as MealBolusTreatment).carbs).toBe(undefined);
    expect((treatments[2] as MealBolusTreatment).insulin).toBe(0.1);
  });

  test("takes closest carb record for meal bolus", () => {
    // Given an identified meal bolus and two preceeding carb corrections
    const identifiedMealBolus: MealBolusTreatment[] = [
      {
        eventType: "Meal Bolus",
        carbs: undefined,
        insulin: 0.1,
        created_at: "2022-11-05T13:28:58",
        app: testApp,
      },
    ];
    const identifiedCarbCorrections: CarbCorrectionTreatment[] = [
      {
        eventType: "Carb Correction",
        carbs: 10,
        created_at: "2022-11-05T13:28:00",
        app: testApp,
      },
      {
        eventType: "Carb Correction",
        carbs: 5,
        created_at: "2022-11-05T13:28:55",
        app: testApp,
      },
    ];

    // When merging the treatments
    const { mealBoli, mergedCarbCorrections } = mergeBolusAndCarbTreatments(
      identifiedMealBolus,
      identifiedCarbCorrections
    );

    // Then expect to get the bolus with matching carbs and a postponsed carb record (will be a carb correction in next run)
    expect(mealBoli).toHaveLength(1);
    expect(mealBoli[0].carbs).toBe(5);
    expect(mergedCarbCorrections).toHaveLength(1);
    expect(mergedCarbCorrections[0].carbs).toBe(5);
  });

  test("takes closest carb records for meal boli", () => {
    // Given two identified meal boli and two carb corrections
    const identifiedMealBolus: MealBolusTreatment[] = [
      {
        eventType: "Meal Bolus",
        carbs: undefined,
        insulin: 0.1,
        created_at: "2022-11-05T13:28:58",
        app: testApp,
      },
      {
        eventType: "Meal Bolus",
        carbs: undefined,
        insulin: 0.1,
        created_at: "2022-11-05T13:28:00",
        app: testApp,
      },
    ];
    const identifiedCarbCorrections: CarbCorrectionTreatment[] = [
      {
        eventType: "Carb Correction",
        carbs: 10,
        created_at: "2022-11-05T13:28:00",
        app: testApp,
      },
      {
        eventType: "Carb Correction",
        carbs: 5,
        created_at: "2022-11-05T13:28:55",
        app: testApp,
      },
    ];

    // When merging the treatments
    const { mealBoli, mergedCarbCorrections } = mergeBolusAndCarbTreatments(
      identifiedMealBolus,
      identifiedCarbCorrections
    );

    // Then expect to get the bolus with matching carbs and a postponsed carb record (will be a carb correction in next run)
    expect(mealBoli).toHaveLength(2);
    expect(mealBoli[0].carbs).toBe(5);
    expect(mealBoli[1].carbs).toBe(10);
    expect(mergedCarbCorrections).toHaveLength(2);
    expect(mergedCarbCorrections[0].carbs).toBe(5);
    expect(mergedCarbCorrections[1].carbs).toBe(10);
  });

  test("imports insulin basal records as temp basal treatments", () => {
    // Given a basal record
    const records: PatientRecordWithDeviceData<BasalRecord>[] = [
      {
        type: "insulin_basal",
        created_at: "2022-11-05T13:28:00",
        value: 0.5,
        unit: "U/h",
        flags: [],
        device: testDevice,
      },
    ];

    // When attempting to identify treatments
    const treatments = identifyTreatments(records);

    // The basal record is transformed to a temp basal treatment
    expect(treatments).toHaveLength(1);
    const tempBasalTreatment: TempBasalTreatment =
      treatments[0] as TempBasalTreatment;
    expect(tempBasalTreatment.absolute).toBe(0.5);
    // default duration should be 360 minutes (as otherwise nightscout will ignore the event)
    expect(tempBasalTreatment.duration).toBe(360);
    expect(tempBasalTreatment.created_at).toBe(
      new Date("2022-11-05T13:28:00").toISOString()
    );
  });

  test("uses total value of correction bolus", () => {
    // Given a correction bolus
    const correctionBolusRecord: PatientRecordWithDeviceData = {
      type: "insulin_bolus",
      created_at: "2023-01-03T22:26:56",
      unit: "U",
      total_value: 0.5,
      spike_value: 0.5,
      suggested: 0,
      suggestion_overridden: "yes",
      suggestion_based_on_bg: "yes",
      suggestion_based_on_carb: "no",
      programmed_bg_correction: 0.001,
      flags: [
        {
          flag: 1034,
          description: "Bolus type ezbg",
        },
      ],
      device: testDevice,
    };

    // When attempting to convert it to a treatment
    const treatment = diasendRecordToNightscoutTreatment(correctionBolusRecord);

    // Then expect the insulin to match the record's total value
    expect((treatment as CorrectionBolusTreatment).insulin).toBe(0.5);
  });

  test("deduplicating treatments", () => {
    // Given a list of (detected) treatments and a list of pre-existing treatments
    const newTreatments: Treatment[] = [
      {
        eventType: "Temp Basal",
        created_at: "2022-11-05T11:00:00Z",
        app: testApp,
        absolute: 0.5,
        duration: 360,
      },
      {
        eventType: "Carb Correction",
        created_at: "2022-11-05T12:00:00Z",
        app: testApp,
        carbs: 5,
      },
      {
        eventType: "Meal Bolus",
        created_at: "2022-11-05",
        app: testApp,
        insulin: 0.5,
        carbs: 10,
      },
      {
        eventType: "Meal Bolus",
        created_at: "2022-11-05T13:30:00Z",
        app: testApp,
        insulin: 1.2,
        carbs: undefined,
      },
      {
        eventType: "Temp Basal",
        created_at: "2022-11-05T13:00:00Z",
        app: testApp,
        absolute: 0.2,
        duration: 360,
      },
    ];
    const existingTreatments: Treatment[] = [
      {
        _id: "existingTreatment1",
        insulin: null,
        eventType: "Temp Basal",
        created_at: "2022-11-05T11:00:00Z",
        app: testApp,
        utcOffset: 0,
        absolute: 0.5,
        duration: 360,
      },
      {
        eventType: "Meal Bolus",
        created_at: "2022-11-05",
        app: testApp,
        insulin: 0.5,
        carbs: 10,
      },
      {
        eventType: "Meal Bolus",
        created_at: "2022-11-05T12:30:00Z",
        app: testApp,
        utcOffset: 0,
        insulin: 1.2,
      },
    ];

    // When trying to deduplicate the list
    const remainingTreatments = deduplicateTreatments(
      newTreatments,
      existingTreatments
    );

    // Then expect all duplicated treatments to be removed
    expect(remainingTreatments).toHaveLength(3);
    expect(remainingTreatments).toEqual<Treatment[]>([
      {
        eventType: "Carb Correction",
        created_at: "2022-11-05T12:00:00Z",
        app: testApp,
        carbs: 5,
      },
      {
        app: "diasend",
        carbs: undefined,
        created_at: "2022-11-05T13:30:00Z",
        eventType: "Meal Bolus",
        insulin: 1.2,
      },
      {
        eventType: "Temp Basal",
        created_at: "2022-11-05T13:00:00Z",
        app: testApp,
        duration: 360,
        absolute: 0.2,
      },
    ]);
  });
});
