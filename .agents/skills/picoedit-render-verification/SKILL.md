# picoedit-render-verification

Use this skill after a PicoEdit render, before marking a run successful.
Verification is read-only. If a check fails, report likely causes and the files to inspect; do not repair automatically.

## Required Checks

Verify all of the following:

- `input/voice.mp3` duration with `ffprobe`.
- Final `output/timeline_with_captions.json` `segments[-1].end`.
- Final `output/timeline_with_captions.json` `caption_cues[-1].end`.
- `output/selected_clips/` file count equals `segments.length`.
- `output/rough_cut_plan.json` has `ok = true`.
- `output/rough_cut.mp4` duration with `ffprobe`.
- `output/asset_manifest_check.json` has `missing_count = 0`.

## Pass Conditions

All four timing checks are required for `status: "pass"`:

- `abs(voice_duration - final_segment_end) <= 0.1`
- `abs(voice_duration - final_caption_end) <= 0.1`
- `abs(voice_duration - rough_cut_duration) <= 0.1`
- `abs(final_segment_end - rough_cut_duration) <= 0.1`

If any timing check fails, set the verification result to:

```json
{
  "status": "needs_revalidation"
}
```

## Suggested Commands

Use PowerShell with UTF-8 reads for JSON:

```powershell
$timeline = Get-Content output\timeline_with_captions.json -Raw -Encoding UTF8 | ConvertFrom-Json
$plan = Get-Content output\rough_cut_plan.json -Raw -Encoding UTF8 | ConvertFrom-Json
$manifestCheck = Get-Content output\asset_manifest_check.json -Raw -Encoding UTF8 | ConvertFrom-Json
$ffprobe = ".\tools\ffmpeg\bin\ffprobe.exe"
& $ffprobe -v error -show_entries format=duration -of csv=p=0 input\voice.mp3
& $ffprobe -v error -show_entries format=duration -of csv=p=0 output\rough_cut.mp4
Get-ChildItem output\selected_clips -File
```

## Failure Reporting

When verification fails, report:

- Failed check and observed value.
- Expected value.
- Files to inspect.
- Whether the mismatch is likely from stale output, overwritten audio, missing assets, skipped caption cue generation, or render failure.
- The possibility that the current `input/voice.mp3` was overwritten after the run.
- The possibility that `output/timeline_with_captions.json` is from an older generation.
- The possibility that only `output/rough_cut.mp4` is from an older generation.
- The run id and hashes that should be checked before treating the issue as a regression.

Do not edit files, regenerate assets, or change logic as part of this skill.
