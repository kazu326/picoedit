# 2026-07-06 39.92s Caption Rescue Run

## Summary

Status: `pass`

This is PicoEdit's first official golden baseline. It is the first golden run after adding short Japanese caption cue rescue. The archived voice, generated timeline, captions, selected clips, rough cut plan, and rough cut are from the same 39.92-second generation.

## Verification

- Archived voice duration: 39.92s
- Final `segment.end`: 39.92s
- Final `caption_cue.end`: 39.92s
- `rough_cut.mp4` duration: 39.92s
- Voice to segment diff: 0s
- Voice to caption diff: 0s
- Voice to render diff: 0s
- Segment to render diff: 0s
- `selected_clips`: 7
- `segments`: 7
- `rough_cut_plan.ok`: true
- `asset_manifest_check.missing_count`: 0

## Caption Rescue

- `caption_009`: `逆にChatGPTに質問をしてもらいます`
- Start/end: 17.92-20.72s
- Duration: 2.80s
- `caption_010`: `実はこの使い方、`
- The 1.84s gap from 20.72 to 22.56 was not crossed.

## Visual Review

- Good: `ai_context_chatgpt_icon_typing_001.mp4` fits the opening ChatGPT/search hook.
- Good: `negative_future_hourglass_falling_005.mp4` supports the "損をしています" problem segment.
- Good: workspace/code/typing clips support the explanation sections without changing the timing basis.
- Unnatural: `segment_05` loops `result_light_glowing_book_shining_011.mp4` for 10.84s from a 6.04s source, so the repeat may be visible.
- Unnatural: `segment_07` is only 1.00s, making the CTA clip very brief.
- Subtitle/video drift: no large timing drift found in verification.
- Keep next time: archive the voice before processing, use `segments` as the only video time base, and reject stale 42.96s artifacts.
- Improvement candidates, not implemented now: choose or prepare a longer proof-role asset for long proof segments; make Japanese cue splitting more morphology-aware before rescue is needed.

## Artifacts

- Archived voice: `runs/2026-07-06_004541_3992s_caption-rescue/input/voice.mp3`
- Timeline copy: `runs/2026-07-06_004541_3992s_caption-rescue/timeline_with_captions.json`
- Rough cut plan copy: `runs/2026-07-06_004541_3992s_caption-rescue/rough_cut_plan.json`
- Asset manifest check copy: `runs/2026-07-06_004541_3992s_caption-rescue/asset_manifest_check.json`
- Selected clips list: `runs/2026-07-06_004541_3992s_caption-rescue/selected_clips.json`
- Rough cut source: `output/rough_cut.mp4`
- Rough cut sha256: `1297a91605e3c78b90425b36b8cbc16f1e94fc4657f5780928127a4391ac079c`
