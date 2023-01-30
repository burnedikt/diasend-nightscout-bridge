import {
  CarbCorrectionTreatment,
  CorrectionBolusTreatment,
  MealBolusTreatment,
  TempBasalTreatment,
  Treatment,
} from "../nightscout/types";
import { isSubsetEqual } from "../utils/equality";

export function isCarbCorrection(
  treatment: Treatment
): treatment is CarbCorrectionTreatment {
  return treatment.eventType === "Carb Correction";
}

export function isMealBolus(
  treatment: Treatment
): treatment is MealBolusTreatment {
  return treatment.eventType === "Meal Bolus";
}

export function isTempBasal(
  treatment: Treatment
): treatment is TempBasalTreatment {
  return treatment.eventType === "Temp Basal";
}

export function isCorrectionBolus(
  treatment: Treatment
): treatment is CorrectionBolusTreatment {
  return treatment.eventType === "Correction Bolus";
}

export function isTreatmentEqual(
  treatment1: Treatment,
  treatment2: Treatment
): boolean {
  const baseMatchingKeys: (keyof Treatment)[] = [
    "created_at",
    "device",
    "app",
    "notes",
  ];

  if (treatment1.eventType !== treatment2.eventType) {
    return false;
  }

  if (isMealBolus(treatment1) && isMealBolus(treatment2)) {
    const matchingKeys: (keyof MealBolusTreatment)[] = [
      ...baseMatchingKeys,
      "carbs",
      "insulin",
    ];
    return isSubsetEqual(treatment1, treatment2, matchingKeys);
  }

  if (isCarbCorrection(treatment1) && isCarbCorrection(treatment2)) {
    const matchingKeys: (keyof CarbCorrectionTreatment)[] = [
      ...baseMatchingKeys,
      "carbs",
    ];
    return isSubsetEqual(treatment1, treatment2, matchingKeys);
  }

  if (isCorrectionBolus(treatment1) && isCorrectionBolus(treatment2)) {
    const matchingKeys: (keyof CarbCorrectionTreatment)[] = [
      ...baseMatchingKeys,
      "insulin",
    ];
    return isSubsetEqual(treatment1, treatment2, matchingKeys);
  }

  if (isTempBasal(treatment1) && isTempBasal(treatment2)) {
    const matchingKeys: (keyof CarbCorrectionTreatment)[] = [
      ...baseMatchingKeys,
      "absolute",
      "duration",
    ];
    return isSubsetEqual(treatment1, treatment2, matchingKeys);
  }

  throw new Error("Not implemented");
}

export function getTreatmentReference(treatment: Treatment): string {
  if (isMealBolus(treatment)) {
    return `${treatment.created_at} ${treatment.carbs ?? "?"}g ${
      treatment.insulin
    }U`;
  }

  if (isCarbCorrection(treatment)) {
    return `${treatment.created_at} ${treatment.carbs}g`;
  }

  if (isCorrectionBolus(treatment)) {
    return `${treatment.created_at} ${treatment.insulin}U`;
  }

  if (isTempBasal(treatment)) {
    return `${treatment.created_at} ${treatment.absolute}U ${treatment.duration}min`;
  }

  throw new Error("Not implemented");
}
