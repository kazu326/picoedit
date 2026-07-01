#!/usr/bin/env python3
"""Build a simple rough cut from timeline slots and folder-based assets."""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv"}
PROJECT_ROOT = Path(__file__).resolve().parent.parent


class RoughCutError(Exception):
    """An expected, user-facing rough cut build error."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a rough cut from a JSON timeline template."
    )
    parser.add_argument("--template", required=True, help="Path to the template JSON file")
    return parser.parse_args()


def require_command(name: str) -> str:
    command = shutil.which(name)
    if command is not None:
        return command

    bundled_command = PROJECT_ROOT / "tools" / "ffmpeg" / "bin" / f"{name}.exe"
    if bundled_command.is_file():
        return str(bundled_command)

    raise RoughCutError(
        f"Required command '{name}' was not found on PATH or at "
        f"'{bundled_command}'. Install FFmpeg or place its executables in "
        f"'{bundled_command.parent}'."
    )


def run_command(command: list[str], context: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        details = result.stderr.strip() or result.stdout.strip() or "No command output."
        raise RoughCutError(f"{context} failed:\n{details}")
    return result


def load_template(template_path: Path) -> dict[str, Any]:
    if not template_path.is_file():
        raise RoughCutError(f"Template file does not exist: {template_path}")

    try:
        with template_path.open("r", encoding="utf-8") as file:
            template = json.load(file)
    except json.JSONDecodeError as exc:
        raise RoughCutError(f"Template JSON is invalid: {template_path}\n{exc}") from exc
    except OSError as exc:
        raise RoughCutError(f"Could not read template: {template_path}\n{exc}") from exc

    required_keys = ("template_id", "output_size", "fps", "slots")
    missing = [key for key in required_keys if key not in template]
    if missing:
        raise RoughCutError(f"Template is missing required fields: {', '.join(missing)}")
    if not isinstance(template["slots"], list) or not template["slots"]:
        raise RoughCutError("Template field 'slots' must be a non-empty list.")

    try:
        width_text, height_text = str(template["output_size"]).lower().split("x", maxsplit=1)
        width = int(width_text)
        height = int(height_text)
        fps = float(template["fps"])
    except (TypeError, ValueError) as exc:
        raise RoughCutError(
            "Template fields 'output_size' and 'fps' must be valid positive numbers."
        ) from exc
    if width <= 0 or height <= 0 or fps <= 0:
        raise RoughCutError("Template output size and fps must be greater than zero.")

    template["_width"] = width
    template["_height"] = height
    template["_fps"] = fps
    return template


def validate_slot(slot: Any, index: int) -> tuple[str, str, str, float]:
    if not isinstance(slot, dict):
        raise RoughCutError(f"Slot #{index + 1} must be a JSON object.")

    required_keys = ("slot_id", "label", "folder", "target_duration")
    missing = [key for key in required_keys if key not in slot]
    if missing:
        raise RoughCutError(
            f"Slot #{index + 1} is missing required fields: {', '.join(missing)}"
        )

    try:
        target_duration = float(slot["target_duration"])
    except (TypeError, ValueError) as exc:
        raise RoughCutError(
            f"Slot '{slot['slot_id']}' has an invalid target_duration."
        ) from exc
    if target_duration <= 0:
        raise RoughCutError(
            f"Slot '{slot['slot_id']}' target_duration must be greater than zero."
        )

    return (
        str(slot["slot_id"]),
        str(slot["label"]),
        str(slot["folder"]),
        target_duration,
    )


def probe_duration(ffprobe: str, video_path: Path) -> float:
    result = run_command(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        f"ffprobe for '{video_path}'",
    )
    try:
        duration = float(result.stdout.strip())
    except ValueError as exc:
        raise RoughCutError(
            f"ffprobe returned an invalid duration for '{video_path}': {result.stdout.strip()}"
        ) from exc
    if duration <= 0:
        raise RoughCutError(f"Video duration must be greater than zero: {video_path}")
    return duration


def relative_project_path(path: Path) -> str:
    try:
        relative = path.resolve().relative_to(PROJECT_ROOT)
        return relative.as_posix()
    except ValueError:
        return path.resolve().as_posix()


def find_video_candidates(folder: Path, used_assets: set[Path]) -> list[Path]:
    if not folder.is_dir():
        raise RoughCutError(f"Asset folder does not exist: {folder}")

    videos = sorted(
        (
            path
            for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
        ),
        key=lambda path: (path.name.casefold(), path.name),
    )
    if not videos:
        raise RoughCutError(f"No video files were found in asset folder: {folder}")

    unused = [path for path in videos if path.resolve() not in used_assets]
    if not unused:
        raise RoughCutError(
            f"No unused video files remain in asset folder: {folder}"
        )
    return unused


def select_asset(
    ffprobe: str,
    folder: Path,
    target_duration: float,
    used_assets: set[Path],
    slot_id: str,
) -> tuple[Path, float]:
    candidates = find_video_candidates(folder, used_assets)
    first_candidate: tuple[Path, float] | None = None
    for candidate in candidates:
        duration = probe_duration(ffprobe, candidate)
        if first_candidate is None:
            first_candidate = (candidate, duration)
        if duration >= target_duration:
            return candidate, duration

    if first_candidate is None:
        raise RoughCutError(f"No unused video files remain in asset folder: {folder}")
    candidate, duration = first_candidate
    print(
        (
            f"WARNING: Slot '{slot_id}' has no unused asset at least "
            f"{target_duration:.3f}s long. Using '{relative_project_path(candidate)}' "
            f"at normal speed ({duration:.3f}s); the slot will be short."
        ),
        file=sys.stderr,
    )
    return candidate, duration


def make_segment(
    ffmpeg: str,
    ffprobe: str,
    source: Path,
    destination: Path,
    speed: float,
    intended_duration: float,
    width: int,
    height: int,
    fps: float,
    slot_id: str,
) -> float:
    video_filter = (
        f"setpts=(PTS-STARTPTS)/{speed:.12f},"
        f"trim=duration={intended_duration:.12f},"
        "setpts=PTS-STARTPTS,"
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},"
        f"fps={fps:.12g},"
        "setsar=1"
    )
    run_command(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-an",
            "-vf",
            video_filter,
            "-t",
            f"{intended_duration:.12f}",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(destination),
        ],
        f"FFmpeg segment build for slot '{slot_id}'",
    )
    return probe_duration(ffprobe, destination)


def write_concat_file(path: Path, segment_paths: list[Path]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as file:
        for segment_path in segment_paths:
            escaped_path = segment_path.resolve().as_posix().replace("'", "'\\''")
            file.write(f"file '{escaped_path}'\n")


def concat_segments(
    ffmpeg: str,
    concat_file: Path,
    output_path: Path,
    voice_path: Path,
    video_duration: float,
) -> None:
    if voice_path.is_file():
        command = [
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-i",
            str(voice_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-t",
            f"{video_duration:.12f}",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    else:
        command = [
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    run_command(command, "FFmpeg final concatenation")


def write_timeline(template_id: str, segments: list[dict[str, Any]], path: Path) -> None:
    timeline = {
        "template_id": template_id,
        "output": "output/rough_cut.mp4",
        "segments": segments,
    }
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(timeline, file, ensure_ascii=False, indent=2)
        file.write("\n")


def write_edit_list(segments: list[dict[str, Any]], path: Path) -> None:
    fieldnames = ["slot_id", "label", "start", "end", "duration", "folder", "asset", "speed"]
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(segments)


def build_rough_cut(template_path: Path) -> None:
    template = load_template(template_path)
    ffmpeg = require_command("ffmpeg")
    ffprobe = require_command("ffprobe")

    output_dir = PROJECT_ROOT / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    rough_cut_path = output_dir / "rough_cut.mp4"
    voice_path = PROJECT_ROOT / "input" / "voice.wav"

    used_assets: set[Path] = set()
    timeline_segments: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix="roughcut_") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        segment_paths: list[Path] = []
        current_start = 0.0

        for index, slot in enumerate(template["slots"]):
            slot_id, label, folder_text, target_duration = validate_slot(slot, index)
            folder = PROJECT_ROOT / Path(folder_text)
            source, source_duration = select_asset(
                ffprobe, folder, target_duration, used_assets, slot_id
            )
            used_assets.add(source.resolve())

            speed = max(source_duration / target_duration, 1.0)
            intended_duration = min(source_duration, target_duration)
            segment_path = temp_dir / f"{index:03d}_{slot_id}.mp4"
            actual_duration = make_segment(
                ffmpeg=ffmpeg,
                ffprobe=ffprobe,
                source=source,
                destination=segment_path,
                speed=speed,
                intended_duration=intended_duration,
                width=template["_width"],
                height=template["_height"],
                fps=template["_fps"],
                slot_id=slot_id,
            )
            segment_paths.append(segment_path)

            end = current_start + actual_duration
            timeline_segments.append(
                {
                    "slot_id": slot_id,
                    "label": label,
                    "start": round(current_start, 6),
                    "end": round(end, 6),
                    "duration": round(actual_duration, 6),
                    "folder": Path(folder_text).as_posix(),
                    "asset": relative_project_path(source),
                    "speed": round(speed, 6),
                }
            )
            current_start = end
            print(
                (
                    f"[{index + 1}/{len(template['slots'])}] {slot_id}: "
                    f"{relative_project_path(source)} -> {actual_duration:.3f}s "
                    f"at {speed:.3f}x"
                )
            )

        concat_file = temp_dir / "concat.txt"
        write_concat_file(concat_file, segment_paths)
        concat_segments(ffmpeg, concat_file, rough_cut_path, voice_path, current_start)

    write_timeline(
        str(template["template_id"]), timeline_segments, output_dir / "timeline.json"
    )
    write_edit_list(timeline_segments, output_dir / "edit_list.csv")
    print(f"Created: {relative_project_path(rough_cut_path)}")
    print("Created: output/timeline.json")
    print("Created: output/edit_list.csv")


def main() -> int:
    args = parse_args()
    template_path = Path(args.template)
    if not template_path.is_absolute():
        template_path = Path.cwd() / template_path

    try:
        build_rough_cut(template_path.resolve())
    except RoughCutError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"ERROR: File operation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
