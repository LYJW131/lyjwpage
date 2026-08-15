"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import mascotFetchData from "@/lib/mascot-fetch.json";

const LOOP_PAUSE_MS = 5_000;
const FIRST_POSE = 0;

// The source animation uses a 34 × 23 half-cell grid. This transform makes
// pose 0 occupy the same 24 × 15 visual bounds as the existing 24 px icon.
const GRID_LEFT = 10;
const GRID_TOP = 7;
const TARGET_TOP = 5;
const CELL_WIDTH = 1;
const CELL_HEIGHT = 15 / 16;

interface SpriteRun {
  color: string;
  height: number;
  width: number;
  x: number;
  y: number;
}

const palette = mascotFetchData.palette as Record<string, string>;

const poses: SpriteRun[][] = mascotFetchData.poses.map((rows) =>
  rows.flatMap((row, rowIndex) => {
    const runs: SpriteRun[] = [];
    let column = 0;

    while (column < row.length) {
      const symbol = row[column];
      if (symbol === ".") {
        column += 1;
        continue;
      }

      let runLength = 1;
      while (row[column + runLength] === symbol) runLength += 1;

      runs.push({
        color: palette[symbol],
        height: CELL_HEIGHT,
        width: runLength * CELL_WIDTH,
        x: (column - GRID_LEFT) * CELL_WIDTH,
        y: TARGET_TOP + (rowIndex - GRID_TOP) * CELL_HEIGHT,
      });
      column += runLength;
    }

    return runs;
  }),
);

/**
 * Claude Code's fetch mascot, adapted from LYJW131/mascot-fetch-loop.
 *
 * The source's measured step timings are preserved. One 4.1 s run is followed
 * by a 5 s pause on its first pose before the next run begins.
 */
export function ClaudeCodeMascot({
  className,
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  const reducedMotion = useReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;

    let cancelled = false;
    let currentStep = 0;
    let timeout = 0;

    queueMicrotask(() => {
      if (!cancelled) setStepIndex(0);
    });

    const scheduleNextStep = () => {
      const atEnd = currentStep === mascotFetchData.sequence.length - 1;
      const delay = mascotFetchData.sequence[currentStep].ms + (atEnd ? LOOP_PAUSE_MS : 0);

      timeout = window.setTimeout(() => {
        if (cancelled) return;
        currentStep = atEnd ? 0 : currentStep + 1;
        setStepIndex(currentStep);
        scheduleNextStep();
      }, delay);
    };

    scheduleNextStep();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [reducedMotion]);

  const poseIndex = reducedMotion ? FIRST_POSE : mascotFetchData.sequence[stepIndex].pose;

  return (
    <svg
      aria-hidden
      className={className}
      height={size}
      role="presentation"
      shapeRendering="crispEdges"
      style={{ flex: "none", lineHeight: 1, overflow: "visible" }}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {poses[poseIndex].map((run, index) => (
        <rect
          fill={run.color}
          height={run.height}
          key={`${poseIndex}-${index}`}
          width={run.width}
          x={run.x}
          y={run.y}
        />
      ))}
    </svg>
  );
}
