import type { ActivityStatus } from "@/lib/types";


export type StoredActivity = {
  activity: ActivityStatus;
  receivedAt: number;
};

export type ActivityHistoryBucket = {
  from: number;
  to: number;
  moveKcal: number | null;
  exerciseMinutes: number | null;
  steps: number | null;
};

export type ActivityHistory = {
  from: number;
  to: number;
  buckets: ActivityHistoryBucket[];
};

export type ActivityReport = {
  current: StoredActivity | null;
  history: ActivityHistory | null;
};

