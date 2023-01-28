type GlucoseUnit = "mg/dl" | "mmol/l";
export interface TokenResponse {
  access_token: string;
  expires_in: string;
  token_type: string;
}

export interface BaseRecord {
  type: "insulin_bolus" | "insulin_basal" | "glucose" | "carb";
  created_at: string;
  flags: { flag: number; description: string }[];
}

export interface GlucoseRecord extends BaseRecord {
  type: "glucose";
  value: number;
  unit: GlucoseUnit;
}
type YesOrNo = "yes" | "no";

export interface BolusRecord extends BaseRecord {
  type: "insulin_bolus";
  unit: "U";
  total_value: number;
  spike_value: number;
  suggested: number;
  suggestion_overridden: YesOrNo;
  suggestion_based_on_bg: YesOrNo;
  suggestion_based_on_carb: YesOrNo;
  programmed_meal?: number;
  programmed_bg_correction?: number;
}
export interface CarbRecord extends BaseRecord {
  type: "carb";
  value: string; // for some reason, carbs are not given as numbers but a string 🤷
  unit: "g";
}

export interface BasalRecord extends BaseRecord {
  type: "insulin_basal";
  unit: "U/h";
  value: number;
}

export type PatientRecord =
  | GlucoseRecord
  | BolusRecord
  | BasalRecord
  | CarbRecord;

export interface DeviceData {
  serial: string;
  manufacturer: string;
  model: string;
}

export type PatientRecordWithDeviceData<
  T extends PatientRecord = PatientRecord
> = T & {
  device: DeviceData;
};
