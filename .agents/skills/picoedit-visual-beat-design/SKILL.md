---
name: picoedit-visual-beat-design
description: Design PicoEdit visual beats and segment boundaries before asset placement. Use when Codex needs to turn a script, audio, or caption timeline into video-switching segments based on role, emotion, pacing, loop suitability, CTA behavior, and whether additional footage is needed. This skill does not change render logic; the final video time axis remains timeline_with_captions.json segments.
---

# picoedit-visual-beat-design

Use this skill before asset placement, when deciding where the video should change.
This is not an asset selector and not a renderer change.

## Core Rule

Treat `segments` as visual beat units, not merely script paragraph units.

The final video time axis is still:

```text
output/timeline_with_captions.json segments
```

Do not let video assets change timing after the fact. Decide visual beat boundaries first, then generate or use `segments`, then place assets against those segments.

## Workflow

1. Read the script by role and emotion.
2. Detect emotional turns that should change visuals around 2 seconds.
3. Allow longer beats only for operation, prompt-entry, screen-action, or natural human performance scenes.
4. Allow natural loops inside the pre-decided visual beat when the footage supports it.
5. Do not loop CTA person footage by default.
6. If a role lacks enough footage, report `additional assets needed` instead of hiding the shortage with forced loops.
7. Freeze the generated `segments` as the only visual time axis before rendering.

## Loop Policy

Looping is not forbidden.

Use a loop when all of these are true:

- The visual beat boundary was decided before asset placement.
- The loop stays within that visual beat.
- The source footage loops naturally.
- The loop does not hide a missing set of needed cuts.

Good loop candidates include clocks, hourglasses, subtle abstract footage, and other visuals with continuous motion.

Do not use looping to disguise that there are not enough assets for the beat design.
For CTA person footage, assume no loop unless there is a specific reason and the motion is visually seamless.

## Role-Based Duration Guide

Use these ranges as judgment targets, not hard validation rules:

- hook / ChatGPT recognition: `1.5-2.5s`
  - Usually avoid loops.
  - Prefer multiple quick cuts when the hook is longer.

- warning / trap / loss / stagnation: `1.5-3s`
  - Use short visual switches for clocks, hourglasses, dark abstract footage, loss, and anxiety.
  - Natural loops are acceptable within the beat; do not hold scarce loop footage too long.

- emotional turn / pattern break: `2-3s`
  - Switch visual meaning to help the viewer feel the turn.

- BODY prompt input / screen operation / AI question screen: `7-12s`
  - Prefer a longer source clip.
  - Do not stitch many short clips if the viewer needs to understand the operation.
  - Adjust the long clip length to the beat instead.

- CTA: `2-4s`
  - Do not loop person footage.
  - For comments, saves, low-temperature "try one thing", and next-episode prompts, use calm CTA cuts.
  - Use strong outcome imagery only when the CTA itself sells a result or future image.

## Short-Cut Zones

Favor shorter visual beats for:

- hooks
- warnings
- urgency or anxiety
- losses
- mental stagnation
- emotional reversals
- pattern breaks

These scenes exist to prevent viewer fatigue and should not rely on one long repeated visual unless the source clip naturally sustains attention.

## Long-Hold Zones

Allow longer beats for:

- BODY prompt input
- actual AI question or chat operation screens
- procedural explanation that viewers must read or understand
- natural human acting where the performance itself carries the scene

Long beats are acceptable only when the visual content keeps changing naturally or the viewer needs time to understand the action.

## CTA Person Footage

Do not loop human CTA clips by default. Person footage usually reveals the loop point and becomes unnatural faster than clocks, hourglasses, or abstract footage.

Prefer multiple short cuts in the same person/world:

- `cta_person_01`: faces camera and lightly nods
- `cta_person_02`: shows a phone screen
- `cta_person_03`: points to the comment area
- `cta_person_04`: smiles slightly at camera
- `cta_person_05`: looks offscreen for next-episode feeling

If these cuts do not exist, report that CTA footage is insufficient instead of stretching one human clip.

## Review Checklist

When reviewing a run, record:

- Average seconds per asset.
- Segments that exceed the role-based guide.
- Whether long segments were justified by operation, prompt input, screen action, or human performance.
- Whether looped footage stayed natural.
- Where additional footage is needed.
- Whether rough visuals came from poor asset choice or from coarse visual beat design.

## Forbidden

- Do not change caption timing to fit video assets.
- Do not use fixed 30-second templates.
- Do not use `slot.target_duration`.
- Do not use FFmpeg stretching or looping to hide missing visual beats or insufficient footage.
- Do not update `picoedit-asset-selection` when the issue is segment granularity.
- Do not change `build_timeline_roughcut.js`, FFmpeg settings, UI, or server API while using this skill.
