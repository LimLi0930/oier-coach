export interface Manifest {
  schemaVersion: number;
  version: string;
  asOf: string;
  scoringVersion: string;
  attributionVersion?: string;
  scoringCommit: string;
  coachCount: number;
  rankedCount: number;
  studentCount: number;
  attributedResultCount: number;
  reviewCount: number;
  years: number[];
  provinces: string[];
  dataPath: string;
  index: string;
  studentIndex: string;
  studentDirectory?: string;
  coachDirectory?: string;
  directoryBytes?: Record<string, number>;
  studentYears: number[];
  studentProvinces: string[];
  indexedStudentCount: number;
  rankedStudentCount: number;
}

export interface PersonPreviewData {
  students?: { id: string; name: string; score: string | null }[];
  guidance?: {
    schoolYear: number;
    province: string;
    coaches: CoachReference[];
  }[];
}

export interface Coach {
  preview?: PersonPreviewData;
  id: string;
  name: string;
  province: string;
  initials: string;
  currentRank: number | null;
  peakRank: number | null;
  peakYear: number | null;
  peakPopulation: number | null;
  score: string | null;
  studentCount: number;
  resultCount: number;
  pendingCount: number;
}

export interface Student {
  id: string;
  uid: number | null;
  name: string;
  initials: string;
  identityStatus: "confirmed" | "review";
}

export interface CoachReference {
  id: string;
  name: string;
  province: string;
}

export interface StudentSummary extends Student {
  preview?: PersonPreviewData;
  provinces: string[];
  currentRank: number | null;
  peakRank: number | null;
  peakYear: number | null;
  peakPopulation: number | null;
  score: string | null;
  coaches: CoachReference[];
  coachCount: number;
  resultCount: number;
}

export type ResultRecord = Pick<
  AttributedResult,
  | "id"
  | "studentId"
  | "contest"
  | "contestType"
  | "event"
  | "year"
  | "schoolYear"
  | "province"
  | "school"
  | "grade"
  | "stage"
  | "award"
  | "examScore"
  | "rank"
  | "population"
  | "core"
  | "score"
>;

export interface StudentResult extends ResultRecord {
  coachIds: string[];
}

export interface StudentDetail extends StudentSummary {
  history: RankingPoint[];
  results: StudentResult[];
  guidancePeriods: GuidancePeriod[];
  manualGuidance: GuidancePeriod[];
}

export interface RankingPoint {
  year: number;
  population: number;
  rank: number;
  score: string;
}

export interface StudentRankingSnapshot {
  year: number;
  population: number;
  entries: { studentId: string; rank: number; score: string }[];
}

export type Entity = "coaches" | "students";
export type RankedPerson = Coach | StudentSummary;

export type Stage = "primary" | "junior" | "senior" | "unknown";

export interface GuidancePeriod {
  id?: string;
  schoolYear?: number | null;
  studentId: string;
  stage: Stage;
  province: string;
  coachIds: string[];
  status?: "consistent" | "chronological" | "review";
  evidenceResultIds?: string[];
  fromSchoolYear?: number;
  toSchoolYear?: number;
  sources?: string[];
  reason?: string;
}

export interface Evidence {
  raw: string;
  source_id: string;
  names: string[];
  transcription_note?: string;
}

export interface AttributedResult {
  id: string;
  originIds: string[];
  studentId: string;
  contest: string;
  event: string;
  contestType: string;
  year: number;
  schoolYear: number;
  province: string;
  school: string;
  grade: string;
  stage: Stage;
  award: string;
  examScore: string;
  rank: number | null;
  population: number | null;
  rankBasis: "explicit" | "score" | "list" | "pending";
  populationBasis: "capacity" | "complete-records" | "pending";
  rankCoefficient?: string;
  core: boolean;
  eligible: boolean;
  score: string | null;
  sourceIds: string[];
  scoringVersion: string;
  evidence: Evidence[];
  attribution: {
    coachId: string;
    type: "direct" | "inferred" | "manual";
    evidence: string[];
    note: string;
    periodId: string;
    ruleVersion?: string;
  };
}

export interface RankingEntry {
  coachId: string;
  rank: number;
  score: string;
  year: number;
  population: number;
}

export interface RankingSnapshot {
  year: number;
  population: number;
  entries: Pick<RankingEntry, "coachId" | "rank" | "score">[];
}

export interface Source {
  id: string;
  url: string;
  type: string;
}

export interface CoachDetail extends Coach {
  history: RankingEntry[];
  students: Student[];
  results: AttributedResult[];
  guidancePeriods: GuidancePeriod[];
  manualGuidance: GuidancePeriod[];
  sources: Source[];
  anchors: {
    id: string;
    contest: string;
    sourceIds: string[];
    evidence: Evidence[];
    correction?: { sources: string[]; reason: string } | null;
  }[];
  updatedAt: string;
  version: string;
}
