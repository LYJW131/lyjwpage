import type {
  PulseAssessmentColumns,
  PulseMeasuredSegment,
  PulsePublicAssessment,
  PulseSegmentColumns,
} from "@/lib/types";

/**
 * Pulse 行对象 ⇄ 线上的列。格式与取舍见 types 里的 PulseSpan。
 * 服务端出口用 to*Columns，卡片用 *Rows 还原；两边都在这里，改一处就够。
 */

export function toAssessmentColumns(rows: PulsePublicAssessment[]): PulseAssessmentColumns {
  const columns: PulseAssessmentColumns = {
    startSec: rows.map((row) => row.startSec),
    endSec: rows.map((row) => row.endSec),
    intensity: rows.map((row) => row.intensity.value),
    confidence: rows.map((row) => row.intensity.confidence),
    continuity: rows.map((row) => row.continuity.value),
    mode: rows.map((row) => row.mode?.value ?? null),
  };
  if (rows.some((row) => row.title)) columns.title = rows.map((row) => row.title ?? null);
  const coverage = Object.fromEntries(rows.flatMap((row, index) => (row.coverage ? [[String(index), row.coverage]] : [])));
  if (Object.keys(coverage).length) columns.coverage = coverage;
  return columns;
}

export function assessmentRows(columns: PulseAssessmentColumns): PulsePublicAssessment[] {
  return columns.startSec.map((startSec, index) => {
    const title = columns.title?.[index];
    const coverage = columns.coverage?.[String(index)];
    const mode = columns.mode[index];
    return {
      startSec,
      endSec: columns.endSec[index],
      ...(coverage ? { coverage } : {}),
      intensity: { value: columns.intensity[index], confidence: columns.confidence[index] },
      continuity: { value: columns.continuity[index] },
      mode: mode ? { value: mode } : null,
      ...(title ? { title } : {}),
    };
  });
}

export function toSegmentColumns(segments: PulseMeasuredSegment[]): PulseSegmentColumns {
  const columns: PulseSegmentColumns = {
    startSec: segments.map((part) => part.startSec),
    endSec: segments.map((part) => part.endSec),
    value: segments.map((part) => part.value),
  };
  if (segments.some((part) => part.title)) columns.title = segments.map((part) => part.title ?? null);
  return columns;
}

export function segmentRows(columns: PulseSegmentColumns): PulseMeasuredSegment[] {
  return columns.startSec.map((startSec, index) => {
    const title = columns.title?.[index];
    return { startSec, endSec: columns.endSec[index], value: columns.value[index], ...(title ? { title } : {}) };
  });
}
