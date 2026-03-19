// Shared types for client + server

export interface EpcData {
  id:           number;
  name:         string;
  email:        string;
  phone?:       string | null;
  logoUrl:      string | null;
  brandColor:   string;
  discountRate: number;
  createdAt:    string;
}

export interface ProjectData {
  id:                  number;
  epcId:               number;
  clientName:          string;
  siteName:            string;
  city:                string;
  systemSizeKwp:       number;
  capexPerKwp:         number;
  oAndMPercent:        number;
  region:              string;
  specificYield:       number;
  tariffType:          string;
  tariffValue:         number;
  exportTariff:        number;
  escalationScenario:  string;
  consumptionKwh:      number;
  selfConsumptionRatio: number;
  financingMode:       string;
  financingParams:     string | null;
  analysisPeriod:      number;
  simplePayback:       number | null;
  npv:                 number | null;
  irr:                 number | null;
  annualProduction:    number | null;
  createdAt:           string;
}

export interface LoanParams {
  loanShare:    number;
  interestRate: number;
  tenorYears:   number;
}

export interface ProjectFormValues {
  clientName:           string;
  siteName:             string;
  city:                 string;
  systemSizeKwp:        number;
  capexPerKwp:          number;
  oAndMPercent:         number;
  region:               string;
  tariffType:           string;
  customTariff?:        number;
  exportTariff?:        number;
  escalationScenario:   string;
  consumptionKwh?:      number;
  selfConsumptionRatio?: number;
  financingMode:        "cash" | "loan";
  loanShare?:           number;
  interestRate?:        number;
  tenorYears?:          number;
  analysisPeriod:       number;
}
