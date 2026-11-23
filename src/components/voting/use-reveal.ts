"use client";

import { useEffect, useRef, useState } from "react";

export type Speed = "normal" | "fast" | "skip";

/** How long a phase shows as "polling" before its results appear, per speed. */
export const POLL_MS: Record<Speed, number> = { normal: 1600, fast: 450, skip: 0 };

/**
 * Reveals seats on the map a few at a time so a finished phase "lights up" smoothly.
 * It only controls what is shown; the votes themselves are already decided by the engine.
 */
export function useReveal(speed: Speed) {
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [revealingPhase, setRevealingPhase] = useState<number | null>(null);
  const speedRef = useRef(speed);
  const queue = useRef<string[]>([]);
  const total = useRef(0);
  const timer = useRef<number | null>(null);

  function stop() {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }

  function add(ids: string[]) {
    if (!ids.length) return;
    setRevealed((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function finish() {
    stop();
    queue.current = [];
    setRevealingPhase(null);
  }

  function flush() {
    add(queue.current);
    finish();
  }

  useEffect(() => {
    speedRef.current = speed;
    if (speed === "skip" && queue.current.length) flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush only touches refs and stable setters
  }, [speed]);

  useEffect(() => stop, []);

  /** Light up these seats (in order) for the given phase. */
  function reveal(ids: string[], phase: number) {
    if (speedRef.current === "skip") {
      add(ids);
      return;
    }
    stop();
    queue.current = [...ids];
    total.current = ids.length;
    setRevealingPhase(phase);
    timer.current = window.setInterval(() => {
      if (speedRef.current === "skip") return flush();
      const per = Math.max(1, Math.ceil(total.current / (speedRef.current === "fast" ? 10 : 30)));
      add(queue.current.splice(0, per));
      if (!queue.current.length) finish();
    }, 40);
  }

  /** Mark seats as already shown (used when a saved game is loaded). */
  function setAll(ids: string[]) {
    setRevealed(new Set(ids));
  }

  return { revealed, revealingPhase, reveal, setAll };
}
