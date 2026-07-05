const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const timelinePath = path.join(root, "output", "timeline.json");
const timestampsPath = path.join(root, "output", "elevenlabs_timestamps.json");
const outputPath = path.join(root, "output", "timeline_with_captions.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function roundTime(value) {
  return Number(Number(value).toFixed(6));
}

function alignmentFrom(timestamps) {
  const alignment = timestamps.normalized_alignment || timestamps.normalizedAlignment || timestamps.alignment;
  if (!alignment) {
    throw new Error("timestampsにalignmentがありません");
  }
  const characters = alignment.characters || [];
  const starts = alignment.characterStartTimesSeconds || alignment.character_start_times_seconds || [];
  const ends = alignment.characterEndTimesSeconds || alignment.character_end_times_seconds || [];
  if (!characters.length || characters.length !== starts.length || characters.length !== ends.length) {
    throw new Error("文字単位timestampsの配列長が一致しません");
  }
  return { characters, starts, ends };
}

function isWhitespace(char) {
  return /\s/.test(char || "");
}

function isHardPunctuation(char) {
  return /[。！？!?」』）)]/.test(char || "");
}

function isSoftPunctuation(char) {
  return /[、，,：:；;]/.test(char || "");
}

function isParticleLike(char) {
  return /[はがをにでとへもやのかねよなぞ]/.test(char || "");
}

function startsWithConjunction(text) {
  return /^(そして|それで|だから|でも|また|ただ|例えば|実は|この|ここ|今回|もっと)/.test(text || "");
}

function isWordChar(char) {
  return /[ぁ-んァ-ヶー一-龯A-Za-z0-9]/.test(char || "");
}

function phraseEndingBonus(textBefore) {
  const endings = [
    "答え、",
    "って",
    "ない？",
    "それ、",
    "なくて、",
    "指示が",
    "なんです。",
    "だけで、",
    "説明から",
    "使える",
    "変わります。",
    "例えば、",
    "なのか、",
    "あるのか、",
    "すれば",
    "いいのか。",
    "ここまで",
    "整理して",
    "くれるようになる。",
    "長いので、",
    "全文と",
    "設定手順は",
    "説明欄に",
    "おくから、",
    "後で",
    "できるように",
    "保存して",
    "使ってみて。",
    "もっと",
    "暮らしを",
    "底上げしたい",
    "フォローして",
    "こちらから",
    "チェックして。",
  ];
  return endings.some((ending) => textBefore.endsWith(ending)) ? 80 : 0;
}

function boundaryScore(chars, boundary, targetEnd) {
  const before = chars[boundary - 1] || "";
  const after = chars[boundary] || "";
  const textBefore = chars.slice(Math.max(0, boundary - 16), boundary).join("").replace(/\s+/g, "");
  let score = 0;

  if (isWhitespace(before)) score += 80;
  if (isHardPunctuation(before)) score += 70;
  if (/[ますすたるうくいだです]/.test(before)) score += 22;
  if (/[ぁ-んァ-ン一-龯A-Za-z0-9]/.test(before) && /[「『]/.test(after)) score += 14;
  score += phraseEndingBonus(textBefore);

  if (isSoftPunctuation(before)) score -= 90;
  if (isParticleLike(before)) score -= 45;
  if (/[、，,]/.test(after)) score -= 35;
  if (isParticleLike(after)) score -= 20;
  if (isHardPunctuation(after)) score -= 140;
  if (isWordChar(before) && isWordChar(after) && !phraseEndingBonus(textBefore)) score -= 110;

  const lookahead = chars.slice(boundary, Math.min(chars.length, boundary + 5)).join("").trim();
  if (startsWithConjunction(lookahead)) score += 12;

  score -= Math.abs(boundary - targetEnd) * 0.75;
  return score;
}

function pickBoundary(chars, starts, ends, startIndex) {
  const minSec = 1.2;
  const maxSec = 2.5;
  const targetSec = 1.85;
  const startTime = Number(starts[startIndex]);
  let minIndex = startIndex + 1;
  let maxIndex = chars.length;
  let targetIndex = startIndex + 1;

  for (let index = startIndex; index < chars.length; index += 1) {
    const elapsed = Number(ends[index]) - startTime;
    if (elapsed < minSec) {
      minIndex = index + 2;
    }
    if (elapsed <= maxSec) {
      maxIndex = index + 1;
    }
    if (elapsed <= targetSec) {
      targetIndex = index + 1;
    }
  }

  maxIndex = Math.max(minIndex, maxIndex);
  if (maxIndex >= chars.length) {
    return chars.length;
  }

  let best = maxIndex;
  let bestScore = -Infinity;
  for (let boundary = minIndex; boundary <= maxIndex; boundary += 1) {
    const duration = Number(ends[boundary - 1]) - startTime;
    if (duration > maxSec) {
      continue;
    }
    const score = boundaryScore(chars, boundary, targetIndex);
    if (score > bestScore) {
      best = boundary;
      bestScore = score;
    }
  }
  return best;
}

function cueText(chars) {
  return chars.join("").replace(/\s+/g, " ").trim();
}

function splitTwoLines(text) {
  const clean = text.trim();
  if (Array.from(clean).length <= 16) {
    return [clean];
  }

  const chars = Array.from(clean);
  const middle = Math.floor(chars.length / 2);
  const candidates = [];
  for (let index = 1; index < chars.length; index += 1) {
    const before = chars[index - 1];
    const after = chars[index];
    if (isSoftPunctuation(before) || isParticleLike(before) || isParticleLike(after)) {
      continue;
    }
    candidates.push({ index, score: -Math.abs(index - middle) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const split = candidates[0]?.index || middle;
  return [chars.slice(0, split).join("").trim(), chars.slice(split).join("").trim()].filter(Boolean);
}

function normalizeDisplayText(text) {
  return text.replace(/^[、，,\s]+/, "").replace(/\s+/g, " ").trim();
}

function rebuildCue(cues, index) {
  const start = roundTime(cues[0].start);
  const end = roundTime(cues[cues.length - 1].end);
  const text = normalizeDisplayText(cues.map((cue) => cue.text).join(""));
  return {
    id: `caption_${String(index + 1).padStart(3, "0")}`,
    text,
    lines: splitTwoLines(text),
    start,
    end,
    duration_sec: roundTime(end - start),
    char_start_index: cues[0].char_start_index,
    char_end_index: cues[cues.length - 1].char_end_index,
  };
}

function postProcessCues(cues) {
  const result = [];
  let index = 0;
  while (index < cues.length) {
    const group = [cues[index]];
    let next = cues[index + 1];
    const text = cues[index].text;
    if (
      next &&
      (/^[、，,]/.test(text) ||
        /^[。！？!?]+$/.test(text) ||
        (text.endsWith("ま") && next.text.startsWith("す")) ||
        (text.endsWith("く") && next.text.startsWith("れる")))
    ) {
      group.push(next);
      index += 1;
    }
    result.push(rebuildCue(group, result.length));
    index += 1;
  }

  const last = result[result.length - 1];
  const previous = result[result.length - 2];
  if (last && previous && last.duration_sec < 1.2) {
    result.splice(result.length - 2, 2, rebuildCue([previous, last], result.length - 2));
  }

  return result.map((cue, cueIndex) => ({ ...cue, id: `caption_${String(cueIndex + 1).padStart(3, "0")}` }));
}

function makeCaptionCues(timestamps) {
  const { characters, starts, ends } = alignmentFrom(timestamps);
  const cues = [];
  let index = 0;

  while (index < characters.length) {
    while (index < characters.length && isWhitespace(characters[index])) {
      index += 1;
    }
    if (index >= characters.length) break;

    const endExclusive = pickBoundary(characters, starts, ends, index);
    let cueChars = characters.slice(index, endExclusive);
    while (cueChars.length && isWhitespace(cueChars[cueChars.length - 1])) {
      cueChars = cueChars.slice(0, -1);
    }
    const lastIndex = index + cueChars.length - 1;
      const text = normalizeDisplayText(cueText(cueChars));
    if (text) {
      const start = roundTime(starts[index]);
      const end = roundTime(ends[lastIndex]);
      cues.push({
        id: `caption_${String(cues.length + 1).padStart(3, "0")}`,
        text,
        lines: splitTwoLines(text),
        start,
        end,
        duration_sec: roundTime(end - start),
        char_start_index: index,
        char_end_index: lastIndex,
      });
    }
    index = endExclusive;
  }

  return postProcessCues(cues);
}

function validate(timeline, cues, timestamps) {
  if (!Array.isArray(timeline.segments) || !timeline.segments.length) {
    throw new Error("timeline.jsonのsegmentsがありません");
  }
  const audioDuration = roundTime(timeline.audio?.duration_sec || timeline.duration_sec || timestamps.alignment?.characterEndTimesSeconds?.at(-1));
  const lastCue = cues.at(-1);
  if (!lastCue || lastCue.end > audioDuration + 0.000001) {
    throw new Error("最終字幕が音声尺を超えています");
  }
  const badDuration = cues.find((cue, index) => {
    const isLast = index === cues.length - 1;
    return cue.duration_sec > 3.4 || (!isLast && cue.duration_sec < 1.2);
  });
  if (badDuration) {
    throw new Error(`字幕尺が範囲外です: ${badDuration.id} ${badDuration.duration_sec}`);
  }
  const tooManyLines = cues.find((cue) => cue.lines.length > 2);
  if (tooManyLines) {
    throw new Error(`字幕が3行以上です: ${tooManyLines.id}`);
  }
  return {
    audioDuration,
    lastCueEnd: lastCue.end,
    cueCount: cues.length,
  };
}

const timeline = readJson(timelinePath);
const timestamps = readJson(timestampsPath);
const originalSegments = JSON.stringify(timeline.segments);
const captionCues = makeCaptionCues(timestamps);
const validation = validate(timeline, captionCues, timestamps);

const output = {
  ...timeline,
  caption_cues: captionCues,
  caption_validation: {
    cue_count: validation.cueCount,
    audio_duration_sec: validation.audioDuration,
    last_cue_end_sec: validation.lastCueEnd,
    last_cue_audio_diff_sec: roundTime(validation.audioDuration - validation.lastCueEnd),
  },
};

if (JSON.stringify(output.segments) !== originalSegments) {
  throw new Error("segmentsが変更されています");
}

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: path.relative(root, outputPath).replaceAll(path.sep, "/"),
  cue_count: captionCues.length,
  first_start: captionCues[0]?.start,
  last_end: captionCues.at(-1)?.end,
  audio_duration_sec: validation.audioDuration,
  max_duration_sec: Math.max(...captionCues.map((cue) => cue.duration_sec)),
  min_duration_sec: Math.min(...captionCues.map((cue) => cue.duration_sec)),
}, null, 2));
