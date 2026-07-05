const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "generate_caption_cues.js");
const source = fs.readFileSync(scriptPath, "utf8");
const definitions = source.split("const timeline = readJson(timelinePath);")[0];
const sandbox = {
  console,
  require,
  __dirname,
  process,
  globalThis: {},
};

vm.runInNewContext(
  `${definitions}
globalThis.testApi = { rescueShortCaptionCues, roundTime };`,
  sandbox
);

const { rescueShortCaptionCues } = sandbox.globalThis.testApi;

function cue(index, text, start, end) {
  return {
    id: `caption_${String(index).padStart(3, "0")}`,
    text,
    lines: [text],
    start,
    end,
    duration_sec: Number((end - start).toFixed(6)),
    char_start_index: index * 10,
    char_end_index: index * 10 + 9,
  };
}

test("joins the reproduced word-internal short cue to the previous cue", () => {
  const cues = [
    ...Array.from({ length: 8 }, (_, index) => cue(index + 1, `dummy${index + 1}`, index * 1.4, index * 1.4 + 1.2)),
    cue(9, "逆にChatGPTに質", 17.92, 19.76),
    cue(10, "問をしてもらいます", 19.76, 20.72),
    cue(11, "実はこの使い方、", 22.56, 23.92),
  ];

  const result = rescueShortCaptionCues(cues);

  assert.equal(result[8].id, "caption_009");
  assert.equal(result[8].text, "逆にChatGPTに質問をしてもらいます");
  assert.equal(result[8].start, 17.92);
  assert.equal(result[8].end, 20.72);
  assert.equal(result[8].duration_sec, 2.8);
  assert.equal(result[9].id, "caption_010");
  assert.equal(result[9].text, "実はこの使い方、");
  assert.equal(result[9].start, 22.56);
  assert.equal(result[9].end, 23.92);
});

test("does not join a short cue across a long right-side silence", () => {
  const cues = [
    cue(1, "前の字幕", 0, 1.3),
    cue(2, "短い", 1.6, 2.2),
    cue(3, "次の字幕", 4.04, 5.4),
  ];

  assert.throws(
    () => rescueShortCaptionCues(cues),
    /短尺字幕cueを安全に結合できません.*cue=caption_002.*previous_gap=0.3.*next_gap=1.84/
  );
});

test("leaves normal cue lists unchanged", () => {
  const cues = [
    cue(1, "正常な字幕A", 0, 1.4),
    cue(2, "正常な字幕B", 1.4, 3.0),
    cue(3, "正常な字幕C", 3.0, 4.5),
  ];

  const result = rescueShortCaptionCues(cues);

  assert.equal(
    JSON.stringify(result.map(({ id, text, start, end, duration_sec }) => ({ id, text, start, end, duration_sec }))),
    JSON.stringify(cues.map(({ id, text, start, end, duration_sec }) => ({ id, text, start, end, duration_sec })))
  );
});

test("preserves cue order, boundaries, and final end after joining", () => {
  const cues = [
    cue(1, "前半", 0, 1.6),
    cue(2, "語中分", 1.6, 3.2),
    cue(3, "割", 3.2, 3.6),
    cue(4, "最後", 3.6, 5.0),
  ];

  const result = rescueShortCaptionCues(cues);

  assert.equal(JSON.stringify(result.map((item) => item.id)), JSON.stringify(["caption_001", "caption_002", "caption_003"]));
  assert.equal(result[1].text, "語中分割");
  assert.equal(result[1].start, 1.6);
  assert.equal(result[1].end, 3.6);
  assert.equal(result.at(-1).end, 5.0);
  for (let index = 1; index < result.length; index += 1) {
    assert.ok(result[index].start >= result[index - 1].end);
  }
});
