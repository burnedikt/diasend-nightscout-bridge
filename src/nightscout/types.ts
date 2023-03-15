interface Base {
  // UUID assigned by nightscout
  _id?: string;
  // The device from which the data originated (including serial number of the device, if it is relevant and safe).\n\nNote&#58; this field is immutable by the client (it cannot be updated or patched)
  device?: string;
  // Application or system in which the record was entered by human or device for the first time.\n\nNote&#58; this field is immutable by the client (it cannot be updated or patched)
  app: string;
}

export interface Entry extends Base {
  // Required timestamp when the entry occured, you can choose from three input formats\n- Unix epoch in milliseconds (1525383610088)\n- Unix epoch in seconds (1525383610)\n- ISO 8601 with optional timezone ('2018-05-03T21:40:10.088Z' or '2018-05-03T23:40:10.088+02:00')\n\nThe date is always stored in a normalized form - UTC with zero offset. If UTC offset was present, it is going to be set in the `utcOffset` field.\n\nNote&#58; this field is immutable by the client (it cannot be updated or patched)
  date: number;
  type: "sgv" | "mbg" | "cal" | "etc";
  // ISO datestring
  dateString: string;
}

export type NightscoutGlucoseUnit = "mg" | "mmol";
type SGVDirection =
  | "NONE"
  | "DoubleUp"
  | "SingleUp"
  | "FortyFiveUp"
  | "Flat"
  | "FortyFiveDown"
  | "SingleDown"
  | "DoubleDown"
  | "NOT COMPUTABLE"
  | "RATE OUT OF RANGE";

export interface SensorGlucoseValueEntry extends Entry {
  type: "sgv";
  // the glucose reading
  sgv: number;
  direction?: SGVDirection;
  noise?: number;
  filtered?: number;
  unfiltered?: number;
  rssi?: number;
}

export interface ManualGlucoseValueEntry extends Entry {
  type: "mbg";
  // the (manually measured) blood glucose
  mbg: number;
}

export const treatmentTypes = [
  "Carb Correction",
  "Correction Bolus",
  "Meal Bolus",
  "Temp Basal",
  "BG Check",
] as const;
export type TreatmentType = typeof treatmentTypes[number];

export interface Treatment extends Base {
  // ISO string timestamp for when the treatment occurred.
  created_at: string;
  eventType: TreatmentType;
  // Description/notes of treatment.
  notes?: string;
  // Who entered the treatment.
  enteredBy?: string;
  // For example the reason why the profile has been switched or why the temporary target has been set.
  reason?: string;
  profile?: string;
  // Current glucose.
  glucose?: number;
  // Method used to obtain glucose, Finger or Sensor.
  glucoseType?: "Sensor" | "Finger" | "Manual";
  [key: string]: unknown;
}
interface BaseBolusTreatment extends Treatment {
  // Amount of insulin, if any. Given in Units
  insulin: number;
  // How many minutes the bolus was given before the meal started.
  preBolus?: number;
}

export interface CorrectionBolusTreatment extends BaseBolusTreatment {
  eventType: "Correction Bolus";
}

export interface MealBolusTreatment extends BaseBolusTreatment {
  eventType: "Meal Bolus";
  // Amount of carbs given.
  carbs?: number;
  // Amount of protein given.
  protein?: number;
  // Amount of fat given.
  fat?: number;
  // Optional reference to a carb correction treatment. Will be used to link treatments (carb correction and meal bolus) together.
  carbsReference?: string;
}

export interface CarbCorrectionTreatment extends Treatment {
  eventType: "Carb Correction";
  // Amount of carbs given.
  carbs: number;
}

export interface TempBasalTreatment extends Treatment {
  eventType: "Temp Basal";
  // Amount of insulin, if any. Given in Units per hour (U/h)
  absolute: number;
  // Number of minutes the temporary basal rate changes is applied
  duration: number;
  // ISO string timestamp for when the record or event occurred. Hard requirement for some events
  created_at: string;
  // Amount of insulin, if any. Given in Units per hour (U/h)
  rate: number
}

export interface TimeBasedValue {
  time: string;
  timeAsSeconds?: number;
  value: number;
}

export interface ProfileConfig {
  dia?: number;
  carbratio: TimeBasedValue[];
  sens: TimeBasedValue[];
  basal: TimeBasedValue[];
  target_low: TimeBasedValue[];
  target_high: TimeBasedValue[];
  startDate?: string;
  timezone?: string;
  carbs_hr?: number;
  delay?: number;
  units?: "mg/dl" | "mmol/l";
}

export interface Profile {
  defaultProfile: string;
  store: { [profileName: string]: ProfileConfig };
}
