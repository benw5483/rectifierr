"""
Bumper / network promo detector.

Strategy
--------
1. Scan the first and last N seconds of each file.
2. Collect three independent signals:
   - Black frames   (strong signal — common transition between show and bumper)
   - Scene changes  (moderate signal — sudden visual cut)
   - Audio silence  (supporting signal — brief mute at bumper boundary)
3. Cluster nearby events into cut-point candidates.
4. Evaluate each cut-point: is the segment before/after it a plausible bumper?
   (duration within configured range, multiple supporting signals)
5. Return the best candidate per position (start / end).

The detector deliberately avoids frame-by-frame comparison with known bumper
fingerprints — those require a constantly-updated database. Instead it relies
on structural cues that are present regardless of network or show.
"""
from __future__ import annotations

import dataclasses
from typing import Optional

from loguru import logger

from app.core.config import settings
from app.services.ffmpeg_service import (
    detect_black_frames,
    detect_scenes,
    detect_silence,
    get_media_info,
)


@dataclasses.dataclass
class BumperCandidate:
    start: float          # seconds from beginning of file
    end: float            # seconds from beginning of file
    confidence: float     # 0.0 – 1.0
    position: str         # "start" | "end"
    signals: dict         # raw signal data for debugging/display

    @property
    def duration(self) -> float:
        return self.end - self.start

    def to_dict(self) -> dict:
        return {
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "duration": round(self.duration, 3),
            "confidence": round(self.confidence, 3),
            "position": self.position,
            "signals": self.signals,
        }


class BumperDetector:
    def __init__(self):
        self.scan_seconds = settings.BUMPER_SCAN_SECONDS
        self.max_duration = settings.BUMPER_MAX_DURATION
        self.min_duration = settings.BUMPER_MIN_DURATION
        self.scene_threshold = settings.SCENE_CHANGE_THRESHOLD
        self.black_threshold = settings.BLACK_FRAME_THRESHOLD
        self.black_min_dur = settings.BLACK_FRAME_MIN_DURATION
        self.silence_db = settings.SILENCE_THRESHOLD_DB
        self.silence_min = settings.SILENCE_MIN_DURATION

    def analyze(self, file_path: str) -> list[BumperCandidate]:
        """
        Run full bumper analysis on a media file.
        Returns a (possibly empty) list of BumperCandidates sorted by confidence desc.
        """
        info = get_media_info(file_path)
        if not info:
            logger.warning(f"Cannot analyze {file_path}: no media info")
            return []

        total_duration = float(info.get("format", {}).get("duration", 0))
        if total_duration < 90:
            logger.debug(f"Skipping {file_path}: too short ({total_duration:.0f}s)")
            return []

        # Limit scan window to at most 1/3 of the file
        window = min(self.scan_seconds, total_duration / 3)

        results: list[BumperCandidate] = []
        results.extend(self._analyze_window(file_path, 0.0, window, "start", total_duration))
        results.extend(
            self._analyze_window(
                file_path, total_duration - window, window, "end", total_duration
            )
        )

        results.sort(key=lambda c: c.confidence, reverse=True)
        logger.info(
            f"Bumper scan complete: {len(results)} candidate(s) in {file_path!r}"
        )
        return results

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _analyze_window(
        self,
        file_path: str,
        seg_start: float,
        seg_duration: float,
        position: str,
        total_duration: float,
    ) -> list[BumperCandidate]:
        logger.debug(
            f"  [{position}] scanning {seg_start:.1f}s → "
            f"{seg_start + seg_duration:.1f}s"
        )

        black = detect_black_frames(
            file_path,
            start=seg_start,
            duration=seg_duration,
            threshold=self.black_threshold,
            min_duration=self.black_min_dur,
        )
        scenes = detect_scenes(
            file_path,
            start=seg_start,
            duration=seg_duration,
            threshold=self.scene_threshold,
        )
        silence = detect_silence(
            file_path,
            start=seg_start,
            duration=seg_duration,
            noise_db=self.silence_db,
            min_duration=self.silence_min,
        )

        cut_points = self._cluster_events(black, scenes, silence)
        if not cut_points:
            return []

        return self._candidates_from_cuts(
            cut_points, position, seg_start, seg_start + seg_duration,
            total_duration, black, scenes, silence,
        )

    def _cluster_events(
        self,
        black: list[dict],
        scenes: list[dict],
        silence: list[dict],
        cluster_gap: float = 1.5,
    ) -> list[tuple[float, float, set[str]]]:
        """
        Merge nearby signal events into clusters.
        Each cluster → one candidate cut-point.
        Returns list of (time, total_weight, signal_types).
        """
        events: list[tuple[float, float, str]] = []

        for bf in black:
            # Both boundaries of a black frame are potential cut points
            events.append((bf["start"], 0.85, "black"))
            events.append((bf["end"], 0.85, "black"))

        for sc in scenes:
            events.append((sc["time"], 0.55, "scene"))

        for si in silence:
            if si.get("duration", 0) >= self.silence_min:
                events.append((si["start"], 0.30, "silence"))
                events.append((si["end"], 0.30, "silence"))

        if not events:
            return []

        events.sort(key=lambda e: e[0])

        clusters: list[tuple[float, float, set[str]]] = []
        c_time, c_weight, c_types = events[0]
        c_types = {c_types}

        for t, w, kind in events[1:]:
            if t - c_time <= cluster_gap:
                c_weight += w
                c_types.add(kind)
            else:
                clusters.append((c_time, c_weight, c_types))
                c_time, c_weight, c_types = t, w, {kind}

        clusters.append((c_time, c_weight, c_types))

        # Only keep clusters with meaningful evidence
        return [(t, w, types) for t, w, types in clusters if w >= 0.75 or len(types) >= 2]

    def _candidates_from_cuts(
        self,
        cut_points: list[tuple[float, float, set[str]]],
        position: str,
        seg_start: float,
        seg_end: float,
        total_duration: float,
        black: list[dict],
        scenes: list[dict],
        silence: list[dict],
    ) -> list[BumperCandidate]:
        candidates = []

        for cut_time, cut_weight, cut_types in cut_points:
            if position == "start":
                bumper_start = seg_start
                bumper_end = cut_time
            else:  # "end"
                bumper_start = cut_time
                bumper_end = total_duration

            dur = bumper_end - bumper_start
            if not (self.min_duration <= dur <= self.max_duration):
                continue

            confidence = self._score(dur, cut_weight, cut_types)
            if confidence < settings.MIN_CONFIDENCE:
                continue

            candidates.append(
                BumperCandidate(
                    start=bumper_start,
                    end=bumper_end,
                    confidence=confidence,
                    position=position,
                    signals={
                        "cut_time": round(cut_time, 3),
                        "cut_weight": round(cut_weight, 3),
                        "signal_types": list(cut_types),
                        "black_frames": len(black),
                        "scene_changes": len(scenes),
                        "silence_events": len(silence),
                    },
                )
            )

        # Return the single best candidate per position
        candidates.sort(key=lambda c: c.confidence, reverse=True)
        return candidates[:1]

    @staticmethod
    def _score(duration: float, weight: float, types: set[str]) -> float:
        """Heuristic confidence score in [0, 1]."""
        score = 0.4

        # Duration bonus — sweet spot for network bumpers is 5–30 s
        if 5 <= duration <= 30:
            score += 0.25
        elif 3 <= duration <= 60:
            score += 0.10

        # Signal diversity bonus
        if len(types) >= 3:
            score += 0.20
        elif len(types) == 2:
            score += 0.12

        # Weight bonus (multiple overlapping events)
        if weight >= 2.0:
            score += 0.15
        elif weight >= 1.2:
            score += 0.08

        # Black frames are the strongest individual signal
        if "black" in types:
            score += 0.10

        return round(min(score, 1.0), 3)
