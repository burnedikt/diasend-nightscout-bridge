import dayjs from "dayjs";
import partition from "lodash.partition";
import * as logger from "loglevel";
import {
  BasalRecord,
  BolusRecord,
  CarbRecord,
  PatientRecord,
  PatientRecordWithDeviceData,
} from "../diasend/types";
import { SynchronizeOptions } from "../index";
import {
  CarbCorrectionTreatment,
  MealBolusTreatment,
  Treatment,
} from "../nightscout/types";
import {
  defaultTempBasalDurationMinutes,
  diasendBolusCarbTimeDifferenceThresholdMilliseconds,
} from "../utils/constants";
import {
  isTimeDiffWithinThreshold,
  sortByTimeDiff,
  sortDatesAscending,
} from "../utils/time";
import { diasendImportnightscoutApp } from "./const";
import {
  getTreatmentReference,
  isCarbCorrection,
  isMealBolus,
  isTreatmentEqual,
} from "./utils";

export type NonGlucoseRecords = BasalRecord | BolusRecord | CarbRecord;

export function diasendRecordToNightscoutTreatment(
  record: PatientRecordWithDeviceData<NonGlucoseRecords>
): Treatment {
  const baseTreatmentData = {
    app: diasendImportnightscoutApp,
    device: `${record.device.model} (${record.device.serial})`,
    created_at: new Date(record.created_at).toISOString(),
  };

  // temp basal changes can be handled directly
  if (record.type === "insulin_basal") {
    return {
      eventType: "Temp Basal",
      absolute: record.value,
      duration: defaultTempBasalDurationMinutes,
      ...baseTreatmentData,
    };
  }

  if (record.type == "carb") {
    return {
      eventType: "Carb Correction",
      carbs: parseInt(record.value),
      ...baseTreatmentData,
    };
  }

  const bolusRecord = record;

  const isMealBolus = "programmed_meal" in bolusRecord;
  if (isMealBolus) {
    const notesParts = [];

    if (bolusRecord.programmed_bg_correction) {
      notesParts.push(`Correction: ${bolusRecord.programmed_bg_correction}`);
    }

    return {
      eventType: "Meal Bolus",
      insulin: bolusRecord.total_value,
      // corresponding carbs are stored in a carb correction treatment. Merging is required!
      carbs: undefined,
      notes: notesParts.length ? notesParts.join(", ") : undefined,
      ...baseTreatmentData,
      created_at: new Date(bolusRecord.created_at).toISOString(),
    };
  } else {
    return {
      eventType: "Correction Bolus",
      insulin: bolusRecord.total_value,
      ...baseTreatmentData,
      created_at: new Date(bolusRecord.created_at).toISOString(),
    };
  }
}

export function deduplicateTreatments(
  treatments: Treatment[],
  existingTreatments: Treatment[]
) {
  return treatments.filter(
    (newTreatment) =>
      !existingTreatments.find((existingTreatment) =>
        isTreatmentEqual(existingTreatment, newTreatment)
      )
  );
}

export async function synchronizeTreatmentRecords(
  records: PatientRecordWithDeviceData<PatientRecord>[],
  { nightscoutClient }: SynchronizeOptions
) {
  // step 1: find out any treatments within the diasend data
  const treatments = identifyTreatments(
    records.filter((record) => record.type !== "glucose")
  );

  // nothing to do if no treatments found
  if (!treatments.length) {
    logger.info("No new treatments found");
    return treatments;
  }

  // step 2: load all existing treatments from nightscout for the same timespan
  const earliestIdentifiedTreatment = treatments.sort((t1, t2) =>
    sortDatesAscending(new Date(t1.created_at), new Date(t2.created_at))
  )[0];

  if (!earliestIdentifiedTreatment) {
    throw new Error("No earliest treatment found");
  }

  // make sure to also look a bit further back to find any potential carbs related to a bolus
  const dateFrom = new Date(
    new Date(earliestIdentifiedTreatment.created_at).getTime() -
      diasendBolusCarbTimeDifferenceThresholdMilliseconds
  );
  logger.debug(
    `Fetching existing treatments from nightscout, starting at ${dateFrom.toISOString()}...`
  );
  const existingTreatments = await nightscoutClient.fetchTreatments({
    dateFrom,
  });

  logger.debug("new treatments: ", treatments);
  logger.debug("existing treatments: ", existingTreatments);

  // step 3: go over all treatments and discard the ones that already exist
  const newTreatments = deduplicateTreatments(treatments, existingTreatments);
  logger.debug("deduplicated treatments: ", newTreatments);

  // step 4: meal bolus are special in a way that their corresponding carbs are reported earlier by diasend than the bolus
  //         which means the carbs might already be on nightscout. Let's try to find all meal boli that don't have matching carbs yet!
  const [newMealBoliWithoutMatchingCarbs, otherNewTreatmens] = partition<
    Treatment,
    MealBolusTreatment
  >(
    newTreatments,
    (treatment): treatment is MealBolusTreatment =>
      isMealBolus(treatment) && treatment.carbs === undefined
  );
  // find the corresponding carbs on nightscout or within the list of new treatments
  const existingMealBoliWithCarbsReference = existingTreatments
    .filter(isMealBolus)
    .filter((mealBolus) => !!mealBolus.carbsReference);
  const carbCorrections = existingTreatments.filter(isCarbCorrection).concat(
    otherNewTreatmens
      .filter(isCarbCorrection)
      // filter out carb corrections that have already been merged into a meal bolus (because referenced by the meal bolus)
      .filter((carbCorrection) => {
        const carbCorrectionReference = getTreatmentReference(carbCorrection);
        return !existingMealBoliWithCarbsReference.find(
          (mealBolus) => mealBolus.carbsReference === carbCorrectionReference
        );
      })
  );

  // a suitable carb correction that acutally belongs to the meal bolus comes directly after / before the bolus (+/-3 minutes). Find it!
  const { mealBoli, mergedCarbCorrections } = mergeBolusAndCarbTreatments(
    newMealBoliWithoutMatchingCarbs,
    carbCorrections
  );

  logger.debug("merged meal boli: ", mealBoli);
  logger.debug("merged carb corrections: ", mergedCarbCorrections);

  // now reassemble the list of treatments to be sent to nightscout
  const treatmentsToBeCreated: Treatment[] = otherNewTreatmens
    // filter out carbs that have been merged into meal boli
    .filter(
      (treatment) =>
        !(
          isCarbCorrection(treatment) &&
          mergedCarbCorrections.includes(treatment)
        )
    )
    // add the merged meal boli
    .concat(mealBoli);

  const treatmentsToBeDeleted = mergedCarbCorrections.filter(
    (carbCorrection) => !!carbCorrection._id
  );

  logger.debug(
    `Sending ${treatmentsToBeCreated.length} new treatments to nightscout`
  );
  logger.debug(
    `Removing ${treatmentsToBeDeleted.length} treatments from nightscout`
  );

  treatmentsToBeCreated.forEach((treatment) => {
    logger.debug(
      "Treatment delay (seconds) for",
      Math.abs(dayjs(treatment.created_at).diff(new Date(), "seconds")),
      treatment
    );
  });

  return await Promise.all([
    nightscoutClient.createTreatments(treatmentsToBeCreated),
    Promise.all(
      treatmentsToBeDeleted.map((treatment) =>
        nightscoutClient.deleteTreatments(treatment)
      )
    ),
  ]);
}

export function identifyTreatments(
  records: PatientRecordWithDeviceData<PatientRecord>[]
) {
  type SupportedRecordType = PatientRecordWithDeviceData<NonGlucoseRecords>;

  const treatments = records
    .filter<SupportedRecordType>((record): record is SupportedRecordType =>
      ["insulin_bolus", "carb", "insulin_basal"].includes(record.type)
    )
    .map(diasendRecordToNightscoutTreatment);

  return treatments;
}

export function mergeBolusAndCarbTreatments(
  mealBolusTreatments: MealBolusTreatment[],
  carbCorrectionTreatments: CarbCorrectionTreatment[]
) {
  const mergedCarbCorrections: CarbCorrectionTreatment[] = [];
  const mealBoli = mealBolusTreatments.map((mealBolus) => {
    if (mealBolus.carbs !== undefined) return mealBolus;

    // look for carb correction treatments within the threshold
    const carbCorrection = carbCorrectionTreatments
      .filter((carbCorrection) =>
        isTimeDiffWithinThreshold(
          carbCorrection.created_at,
          mealBolus.created_at,
          diasendBolusCarbTimeDifferenceThresholdMilliseconds
        )
      )
      .sort((c1, c2) =>
        sortByTimeDiff(c1.created_at, c2.created_at, mealBolus.created_at)
      )[0];

    if (!carbCorrection) {
      logger.warn("Could not find carb correction matchin bolus", mealBolus);
      return mealBolus;
    }

    mergedCarbCorrections.push(carbCorrection);
    return {
      ...mealBolus,
      carbs: carbCorrection.carbs,
      carbsReference: getTreatmentReference(carbCorrection),
    };
  });

  return { mealBoli, mergedCarbCorrections };
}
