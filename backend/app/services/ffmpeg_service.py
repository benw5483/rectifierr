"""
Low-level FFmpeg/ffprobe wrappers used by all detectors.
"""
import json
import os
import subprocess
from pathlib import Path
from typing import Optional

from loguru import logger


def get_media_info(file_path: str) -> Optional[dict]:
    """Return ffprobe JSON for a media file."""
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        file_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            logger.error(f"ffprobe failed for {file_path}: {result.stderr[:200]}")
            return None
        return json.loads(result.stdout)
    except Exception as e:
        logger.error(f"ffprobe error for {file_path}: {e}")
        return None


def detect_scenes(
    file_path: str,
    start: float = 0,
    duration: Optional[float] = None,
    threshold: float = 0.35,
) -> list[dict]:
    """Detect scene changes via FFmpeg's scene filter. Returns list of {time, score}."""
    cmd = ["ffmpeg", "-hide_banner", "-v", "quiet"]
    if start > 0:
        cmd += ["-ss", str(start)]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += [
        "-i", file_path,
        "-vf", f"select='gt(scene,{threshold})',metadata=print:file=-",
        "-an", "-f", "null", "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        scenes = []
        current: dict = {}
        for line in result.stdout.split("\n"):
            line = line.strip()
            if line.startswith("frame:"):
                # New frame block — save previous if complete
                if "time" in current:
                    scenes.append(current)
                current = {}
            elif "pts_time" in line:
                try:
                    current["time"] = float(line.split("pts_time:")[1].strip()) + start
                except (IndexError, ValueError):
                    pass
            elif "scene_score" in line:
                try:
                    current["score"] = float(line.split("scene_score=")[1].strip())
                except (IndexError, ValueError):
                    pass
        if "time" in current:
            scenes.append(current)
        return scenes
    except Exception as e:
        logger.error(f"Scene detection failed for {file_path}: {e}")
        return []


def detect_black_frames(
    file_path: str,
    start: float = 0,
    duration: Optional[float] = None,
    threshold: float = 0.98,
    min_duration: float = 0.1,
) -> list[dict]:
    """Detect black frames via FFmpeg's blackdetect filter.
    Returns list of {start, end, duration}."""
    cmd = ["ffmpeg", "-hide_banner", "-v", "quiet"]
    if start > 0:
        cmd += ["-ss", str(start)]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += [
        "-i", file_path,
        "-vf", f"blackdetect=d={min_duration}:pix_th={threshold}",
        "-an", "-f", "null", "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        intervals = []
        for line in result.stderr.split("\n"):
            if "black_start" not in line:
                continue
            try:
                parts = {}
                for token in line.strip().split():
                    if ":" in token:
                        k, v = token.split(":", 1)
                        parts[k] = v
                intervals.append({
                    "start": float(parts["black_start"]) + start,
                    "end": float(parts["black_end"]) + start,
                    "duration": float(parts["black_duration"]),
                })
            except (KeyError, ValueError):
                pass
        return intervals
    except Exception as e:
        logger.error(f"Black frame detection failed for {file_path}: {e}")
        return []


def detect_silence(
    file_path: str,
    start: float = 0,
    duration: Optional[float] = None,
    noise_db: float = -50.0,
    min_duration: float = 0.3,
) -> list[dict]:
    """Detect audio silence via FFmpeg's silencedetect filter.
    Returns list of {start, end, duration}."""
    cmd = ["ffmpeg", "-hide_banner", "-v", "quiet"]
    if start > 0:
        cmd += ["-ss", str(start)]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += [
        "-i", file_path,
        "-af", f"silencedetect=n={noise_db}dB:d={min_duration}",
        "-vn", "-f", "null", "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        intervals = []
        pending_start: Optional[float] = None
        for line in result.stderr.split("\n"):
            if "silence_start" in line:
                try:
                    pending_start = float(line.split("silence_start:")[1].strip()) + start
                except (IndexError, ValueError):
                    pass
            elif "silence_end" in line and pending_start is not None:
                try:
                    parts = line.split("|")
                    end = float(parts[0].split("silence_end:")[1].strip()) + start
                    dur = float(parts[1].split("silence_duration:")[1].strip())
                    intervals.append({"start": pending_start, "end": end, "duration": dur})
                    pending_start = None
                except (IndexError, ValueError):
                    pass
        return intervals
    except Exception as e:
        logger.error(f"Silence detection failed for {file_path}: {e}")
        return []


def extract_frames(
    file_path: str,
    timestamps: list[float],
    output_dir: str,
    quality: int = 3,
) -> list[str]:
    """Extract JPEG frames at specific timestamps. Returns list of written paths."""
    os.makedirs(output_dir, exist_ok=True)
    paths = []
    for i, ts in enumerate(timestamps):
        out = os.path.join(output_dir, f"frame_{i:05d}.jpg")
        cmd = [
            "ffmpeg", "-hide_banner", "-v", "quiet",
            "-ss", str(ts),
            "-i", file_path,
            "-vframes", "1",
            "-q:v", str(quality),
            out,
        ]
        try:
            subprocess.run(cmd, capture_output=True, timeout=15)
            if os.path.exists(out):
                paths.append(out)
        except Exception as e:
            logger.warning(f"Frame extract failed at t={ts}: {e}")
    return paths


def extract_thumbnail(
    file_path: str,
    timestamp: float,
    output_path: str,
    width: int = 320,
) -> bool:
    """Extract a single thumbnail at a given timestamp."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    cmd = [
        "ffmpeg", "-hide_banner", "-v", "quiet",
        "-ss", str(timestamp),
        "-i", file_path,
        "-vframes", "1",
        "-vf", f"scale={width}:-1",
        "-q:v", "4",
        output_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=15)
        return result.returncode == 0 and os.path.exists(output_path)
    except Exception as e:
        logger.warning(f"Thumbnail extraction failed: {e}")
        return False


def remove_segment(
    input_path: str,
    output_path: str,
    remove_start: float,
    remove_end: float,
    total_duration: float,
) -> bool:
    """
    Remove a time segment from a video by concatenating what remains.
    Uses stream copy for speed; re-encodes only if copy fails.
    """
    segments = []
    if remove_start > 0.5:
        segments.append((0.0, remove_start))
    if remove_end < total_duration - 0.5:
        segments.append((remove_end, total_duration))

    if not segments:
        logger.error("No segments remain after removal — aborting")
        return False

    if len(segments) == 1:
        s_start, s_end = segments[0]
        cmd = [
            "ffmpeg", "-hide_banner", "-v", "quiet",
            "-ss", str(s_start),
            "-to", str(s_end),
            "-i", input_path,
            "-c", "copy",
            output_path,
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=600)
            return r.returncode == 0
        except Exception as e:
            logger.error(f"Single-segment copy failed: {e}")
            return False

    # Multi-segment: use concat filter with re-encode
    filter_parts = []
    concat_inputs = ""
    for i, (s, e) in enumerate(segments):
        filter_parts.append(
            f"[0:v]trim=start={s}:end={e},setpts=PTS-STARTPTS[v{i}];"
            f"[0:a]atrim=start={s}:end={e},asetpts=PTS-STARTPTS[a{i}]"
        )
        concat_inputs += f"[v{i}][a{i}]"
    n = len(segments)
    filter_complex = ";".join(filter_parts) + f";{concat_inputs}concat=n={n}:v=1:a=1[vout][aout]"

    cmd = [
        "ffmpeg", "-hide_banner", "-v", "quiet",
        "-i", input_path,
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", "[aout]",
        output_path,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=3600)
        if r.returncode != 0:
            logger.error(f"FFmpeg concat error: {r.stderr.decode()[:500]}")
        return r.returncode == 0
    except Exception as e:
        logger.error(f"Multi-segment concat failed: {e}")
        return False
