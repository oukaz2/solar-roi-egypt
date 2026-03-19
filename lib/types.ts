// Shared types for client + server  (V3)

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
  id:                   number;
  epcId:                number;
  // V3 metadata
  projectName?:         string | null;
  siteAddress?:         string | null;
  gpsCoords?:           string | null;
  projectNote?:         string | null;
  // Client
  clientName:           string;
  siteName:             string;
  city:                 string;
  // System
  systemSizeKwp:        number;
  capexPerKwp:          number;
  oAndMPercent:         number;
  // Optional BOM
  moduleModel?:         string | null;
  inverterModel?:       string | null;
  storageModel?:        string | null;
  storageCapacityKwh?:  number | null;
  // Production
  region:               string;
  specificYield:        number;
  // Tariffs
  tariffType:           string;
  tariffValue:          number;
  exportTariff:         number;
  escalationScenario:   string;
  // Self-consumption
  consumptionKwh:       number;
  selfConsumptionRatio: number;
  // Financing
  financingMode:        string;
  financingParams:      string | null;
  analysisPeriod:       number;
  // Results
  simplePayback:        number | null;
  npv:                  number | null;
  irr:                  number | null;
  annualProduction:     number | null;
  createdAt:            string;
}

export interface LoanParams {
  loanShare:    number;
  interestRate: number;
  tenorYears:   number;
}
