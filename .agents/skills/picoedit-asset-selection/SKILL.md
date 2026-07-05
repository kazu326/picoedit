---
name: picoedit-asset-selection
description: Judgment guide for PicoEdit asset selection and review. Use when Codex chooses or reviews visual assets for PicoEdit timeline segments, especially when deciding whether assets fit segment role, viewer emotion, semantic meaning, gaze guidance, and whether the visual overpowers the script. This is not an automated selector and must not change rendering logic.
---

# picoedit-asset-selection

Use this skill as a judgment guide when selecting or reviewing visual assets for PicoEdit segments.
Do not change `timeline_with_captions.json` timing. The time axis remains `segments`; this skill only guides asset choice and review language.

## Core Rule

Do not choose assets by script keywords alone.

Judge in this order:

1. Segment role
2. Emotion to create in the viewer
3. Semantic relationship to the line
4. Gaze guidance and information density
5. Whether the asset overpowers the spoken line
6. Whether similar visuals repeat too often

For each segment, record one primary role and at most one secondary role.

## Segment Roles

Use these role labels:

- AIの便利さ・期待
- 危険な罠・警告
- 迷い・先延ばし・停滞
- 時間損失・機会損失
- 長期停滞への恐怖
- 解決策・行動転換
- CTA・安心感・次回予告

## Reusable Candidates

Treat these as useful candidates, not hard rules:

- `hourglass`
  - 危険な罠
  - 焦り
  - 時間損失
  - 機会損失

- `dark grid`
  - 停滞
  - 重さ
  - 長期化する不安
  - 思考が進まない感覚

- `code/work`
  - 行動転換
  - 試す
  - 実行する
  - 作業開始

## Caution Candidates

- `ChatGPT icon`
  - Useful at the opening when the viewer must immediately understand the AI context.
  - Risky in warning or emotional-turn segments because it can become keyword matching.
  - Avoid consecutive use.

- `glowing book`
  - Useful for learning, discovery, understanding, and hope.
  - Do not use by default for warning, stagnation, loss, or fear.

- `luxury car CTA`
  - Useful for achievement, future-image, or aspirational outcome CTAs.
  - Avoid for low-temperature CTAs such as commenting, saving, trying one thing, or next-episode prompts.
  - Ensure the CTA visual does not become stronger than the line.

## CTA Rule

For CTAs, prioritize not interrupting the action.
Prefer calm or grounded visuals for:

- コメントしてほしい
- 保存してほしい
- まず1つ試してほしい
- 次回予告

Use luxury, mansion, car, or strong success imagery only when the CTA itself is selling an outcome or future image.

## Long Segment Review

For long segments, always record:

- Whether the visual stayed watchable for the full segment
- Whether looping was natural
- Whether the visual meaning changed halfway through the spoken line
- Whether more assets are needed
- Whether holding one asset made the message easier to understand

Do not change segment splitting logic as part of this skill.

## Review Checklist

In `review.md`, record:

- Whether the asset matched a word, or matched the role/emotion
- Whether the asset strengthened the explanation
- Whether the asset overpowered the line
- Whether another asset in the same role would also work
- Whether this asset is reusable as a pattern, or only worked in this specific script

## Forbidden

- Do not automate asset selection.
- Do not edit `build_timeline_roughcut.js`.
- Do not change asset manifest structure.
- Do not change UI.
- Do not add scoring functions.
- Do not re-render prior runs.
