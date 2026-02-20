"""
Channel logo / watermark detector.

Strategy
--------
1. Sample frames spread across the middle 90% of the video.
2. Convert each frame to grayscale and stack into a tensor.
3. Compute per-pixel temporal variance. Low-variance pixels are "persistent"
   (they look the same in every frame), which is the hallmark of a burned-in
   watermark / channel bug.
4. Focus on the four corners where logos almost always live.
5. If a corner has a region whose mean persistence exceeds the threshold,
   find the tightest bounding contour and report it.

OpenCV is optional — if it is not installed, logo detection is skipped with
a warning rather than crashing the app.
"""
from __future__ import annotations

import dataclasses
import os
import tempfile
from typing import Optional

from loguru import logger

from app.core.config import settings
from app.services.ffmpeg_service import extract_frames, get_media_info

try:
    import cv2
    import numpy as np
    _CV2_OK = True
except ImportError:
    _CV2_OK = False
    logger.warning("OpenCV not available — logo detection disabled")


@dataclasses.dataclass
class LogoCandidate:
    position: str        # "top-left" | "top-right" | "bottom-left" | "bottom-right"
    x: int
    y: int
    width: int
    height: int
    confidence: float    # mean persistence score for the bounding region
    persistence: float   # fraction of frames where pixel is "stable"

    def to_dict(self) -> dict:
        return {
            "position": self.position,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "confidence": round(self.confidence, 3),
            "persistence": round(self.persistence, 3),
        }


class LogoDetector:
    def __init__(self):
        self.check_interval = settings.LOGO_CHECK_INTERVAL
        self.max_frames = settings.LOGO_MAX_FRAMES
        self.persistence_threshold = settings.LOGO_PERSISTENCE_THRESHOLD
        self.corner_margin = settings.LOGO_CORNER_MARGIN
        self.min_area = settings.LOGO_MIN_AREA

    def analyze(self, file_path: str) -> list[LogoCandidate]:
        """Analyze a video file for persistent watermarks in corner regions."""
        if not _CV2_OK:
            return []

        info = get_media_info(file_path)
        if not info:
            return []

        total_duration = float(info.get("format", {}).get("duration", 0))
        if total_duration < 120:
            logger.debug(f"Skipping logo scan for short file ({total_duration:.0f}s)")
            return []

        # Sample timestamps across the middle 90% of the video
        t_start = total_duration * 0.05
        t_end = total_duration * 0.95
        available = t_end - t_start
        step = max(available / self.max_frames, self.check_interval)
        timestamps = []
        t = t_start
        while t < t_end and len(timestamps) < self.max_frames:
            timestamps.append(t)
            t += step

        with tempfile.TemporaryDirectory() as tmpdir:
            frame_paths = extract_frames(file_path, timestamps, tmpdir)
            if len(frame_paths) < 5:
                logger.warning(
                    f"Not enough frames extracted from {file_path} "
                    f"({len(frame_paths)} / {len(timestamps)})"
                )
                return []

            frames = []
            for fp in frame_paths:
                img = cv2.imread(fp)
                if img is not None:
                    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
                    frames.append(gray)

            if len(frames) < 5:
                return []

            return self._find_logos(frames)

    def _find_logos(self, frames: list) -> list[LogoCandidate]:
        h, w = frames[0].shape
        stack = np.stack(frames, axis=0)

        # Per-pixel temporal variance → persistence map
        variance = np.var(stack, axis=0)
        max_var = float(np.max(variance)) + 1e-6
        persistence = 1.0 - (variance / max_var)

        m = self.corner_margin
        corners = {
            "top-left":     (0,    m,    0,    m),
            "top-right":    (0,    m,    w - m, w),
            "bottom-left":  (h - m, h,  0,    m),
            "bottom-right": (h - m, h,  w - m, w),
        }

        candidates = []
        for name, (y1, y2, x1, x2) in corners.items():
            region = persistence[y1:y2, x1:x2]
            mean_pers = float(np.mean(region))

            if mean_pers < self.persistence_threshold:
                continue

            # Find the tight bounding box of high-persistence pixels
            high = ((region > 0.90) * 255).astype(np.uint8)
            contours, _ = cv2.findContours(
                high, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if not contours:
                continue

            all_pts = np.concatenate(contours, axis=0)
            rx, ry, rw, rh = cv2.boundingRect(all_pts)

            area = rw * rh
            if area < self.min_area or area > (m * m * 0.7):
                continue

            candidates.append(
                LogoCandidate(
                    position=name,
                    x=x1 + rx,
                    y=y1 + ry,
                    width=rw,
                    height=rh,
                    confidence=mean_pers,
                    persistence=mean_pers,
                )
            )

        logger.info(f"Logo scan found {len(candidates)} candidate(s)")
        return candidates
