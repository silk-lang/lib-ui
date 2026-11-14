import { useState } from "react";
import { accent, arabic, display, hairline, hebrew, ink, jp, mono, muted, paper, sans, serif } from "./theme.js";

const row = { display: "flex", flexDirection: "row" };
const column = { display: "flex", flexDirection: "column" };

// A small label naming the layout feature next to it.
function Tag({ children, style }) {
  return (
    <box style={{ ...row, ...style }}>
      <box style={{ fontFamily: mono, fontSize: 10, lineHeight: 1.4, color: accent, borderWidth: 1, borderStyle: "solid", borderColor: "rgba(200, 52, 30, 0.35)", borderRadius: 3, padding: "1px 6px" }}>
        {children}
      </box>
    </box>
  );
}

const Span = ({ style, children }) => <box style={{ display: "inline", ...style }}>{children}</box>;

function Kicker({ number, children }) {
  return (
    <box style={{ ...row, alignItems: "center", gap: 10, fontFamily: mono, fontSize: 11, color: muted }}>
      <box style={{ color: accent }}>{number}</box>
      <box style={{ width: 28, height: 1, backgroundColor: ink }} />
      <box>{children}</box>
    </box>
  );
}

function Cover() {
  const greetings = [
    ["Hello", "Latin"],
    ["مرحبا", "Arabic"],
    ["שלום", "Hebrew"],
    ["नमस्ते", "Devanagari"],
    ["สวัสดี", "Thai"],
    ["こんにちは", "Japanese"],
    ["안녕하세요", "Hangul"],
    ["Γειά σου", "Greek"],
    ["👋🏽", "Emoji"],
  ];
  return (
    <box style={{ ...column, flexGrow: 1 }}>
      <box style={{ ...row, flexGrow: 1, gap: 40 }}>
        <box style={{ ...column, flexGrow: 1, justifyContent: "center", gap: 26 }}>
          <Kicker number="07">Autumn 2026 · A field guide to text layout</Kicker>
          <box style={{ fontFamily: display, fontWeight: 700, fontSize: 112, lineHeight: 0.92, color: ink }}>
            The Shape
            <box style={{ fontStyle: "italic", fontWeight: 400 }}>of Words</box>
          </box>
          <box style={{ fontFamily: serif, fontStyle: "italic", fontSize: 21, lineHeight: 1.45, color: muted, maxWidth: 540 }}>
            Nine scripts, two directions, and columns that run from top to bottom. Every line on these pages is laid out by Silk UI.
          </box>
        </box>
        <box style={{ ...column, alignItems: "flex-end", justifyContent: "center", gap: 14, paddingRight: 8 }}>
          <box style={{ ...row, gap: 18, alignItems: "flex-start" }}>
            <box style={{ writingMode: "vertical-rl", fontFamily: jp, fontSize: 17, lineHeight: 1.7, color: muted, height: 330 }}>
              文字は縦にも横にも流れる。
            </box>
            <box style={{ writingMode: "vertical-rl", fontFamily: jp, fontWeight: 700, fontSize: 68, lineHeight: 1, color: accent, height: 420 }}>
              言葉のかたち
            </box>
          </box>
          <Tag>writing-mode: vertical-rl</Tag>
        </box>
      </box>
      <box style={{ ...column, gap: 10, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: ink, paddingTop: 14 }}>
        <box style={{ ...row, justifyContent: "space-between" }}>
          {greetings.map(([word, script]) => (
            <box key={script} style={{ ...column, alignItems: "center", gap: 4 }}>
              <box style={{ fontFamily: serif, fontSize: 25, lineHeight: 1.3, color: ink }}>{word}</box>
              <box style={{ fontFamily: mono, fontSize: 10, color: muted }}>{script}</box>
            </box>
          ))}
        </box>
        <Tag>font fallback · nine scripts on one line</Tag>
      </box>
    </box>
  );
}

function Headline({ number, kicker, children, aside }) {
  return (
    <box style={{ ...column, gap: 10, paddingBottom: 18, marginBottom: 22, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: ink }}>
      <Kicker number={number}>{kicker}</Kicker>
      <box style={{ ...row, justifyContent: "space-between", alignItems: "flex-end" }}>
        <box style={{ fontFamily: display, fontWeight: 700, fontSize: 54, lineHeight: 1, color: ink }}>{children}</box>
        {aside}
      </box>
    </box>
  );
}

const body = { fontFamily: serif, fontSize: 15, lineHeight: 1.6, color: ink };
const rule = { borderLeftWidth: 1, borderLeftStyle: "solid", borderLeftColor: hairline, paddingLeft: 24 };

function Bidi() {
  return (
    <box style={{ ...column, flexGrow: 1 }}>
      <Headline
        number="01"
        kicker="Bidirectional text"
        aside={<box style={{ fontFamily: arabic, fontWeight: 700, fontSize: 50, lineHeight: 1, color: accent, direction: "rtl" }}>اتجاهان</box>}
      >
        Two directions
      </Headline>
      <box style={{ ...row, gap: 24, flexGrow: 1 }}>
        <box style={{ ...column, gap: 12, flexGrow: 1, flexBasis: 0 }}>
          <box style={{ ...body, fontSize: 16.5, lineHeight: 1.65, textAlign: "justify" }}>
            In Cairo the sign above the bookshop reads <Span style={{ fontFamily: arabic, color: accent }}>مكتبة النور</Span>, “the library of light”, and
            its phone number, 02 2345 6789, still runs left to right inside the Arabic. Across the sea in Tel Aviv, the café on the corner is
            called <Span style={{ fontFamily: hebrew, color: accent }}>קפה השכונה</Span> and has opened at seven since 1998.
          </box>
          <Tag>bidi · English with Arabic and Hebrew inline</Tag>
        </box>
        <box style={{ ...column, gap: 12, flexGrow: 1, flexBasis: 0, ...rule }}>
          <box style={{ ...body, fontFamily: arabic, fontSize: 21, lineHeight: 1.75, direction: "rtl", textAlign: "justify" }}>
            يكتب العربي من اليمين إلى اليسار، لكن الأرقام مثل 2026 و 3.14 تبقى بترتيبها، وكذلك الكلمات اللاتينية مثل{" "}
            <Span style={{ fontFamily: serif, fontStyle: "italic" }}>Silk UI</Span> و <Span style={{ fontFamily: serif, fontStyle: "italic" }}>React</Span> داخل الجملة نفسها.
          </box>
          <Tag style={{ justifyContent: "flex-end" }}>direction: rtl · Arabic with Latin and digits</Tag>
        </box>
        <box style={{ ...column, gap: 12, flexGrow: 1, flexBasis: 0, ...rule }}>
          <box style={{ fontFamily: hebrew, fontWeight: 700, fontSize: 32, lineHeight: 1.35, color: ink, direction: "rtl" }}>
            ״המילים נעות בשני כיוונים, והעין לומדת ללכת אחריהן.״
          </box>
          <box style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: muted, direction: "rtl" }}>— מתוך המדור, עמ׳ 12</box>
          <Tag style={{ justifyContent: "flex-end" }}>direction: rtl · Hebrew pull quote</Tag>
        </box>
      </box>
      <box style={{ ...column, gap: 10, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: hairline, paddingTop: 14 }}>
        <box style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.6, color: ink }}>
          <Span style={{ fontWeight: 600 }}>Contributors </Span>
          <Span style={{ unicodeBidi: "isolate", fontFamily: arabic, fontSize: 15 }}>سارة</Span> wrote 3 essays ·{" "}
          <Span style={{ unicodeBidi: "isolate", fontFamily: hebrew }}>דוד</Span> wrote 12 ·{" "}
          <Span style={{ unicodeBidi: "isolate", fontFamily: jp }}>美咲</Span> wrote 7 · Ana wrote 5
        </box>
        <Tag>unicode-bidi: isolate · names keep the numbers after them in place</Tag>
      </box>
    </box>
  );
}

function Vertical() {
  return (
    <box style={{ ...row, flexGrow: 1, gap: 28 }}>
      <box style={{ ...column, justifyContent: "space-between", alignItems: "center", borderRightWidth: 1, borderRightStyle: "solid", borderRightColor: ink, paddingRight: 18 }}>
        <box style={{ writingMode: "sideways-lr", fontFamily: mono, fontSize: 11, color: muted }}>02 — VERTICAL TYPE — TOP TO BOTTOM</box>
        <box style={{ writingMode: "sideways-lr", fontFamily: display, fontWeight: 700, fontSize: 40, lineHeight: 1, color: ink }}>Top to bottom</box>
      </box>
      <box style={{ ...column, gap: 12, justifyContent: "center" }}>
        <box style={{ writingMode: "vertical-lr", fontFamily: "Noto Sans Mongolian", fontSize: 26, lineHeight: 1.6, color: ink, height: 380 }}>
          ᠮᠣᠩᠭᠣᠯ ᠪᠢᠴᠢᠭ ᠦᠰᠦᠭ
        </box>
        <Tag>vertical-lr · Mongolian</Tag>
      </box>
      <box style={{ ...column, flexGrow: 1, gap: 12, justifyContent: "center", alignItems: "flex-end" }}>
        <box style={{ ...row, gap: 26, alignItems: "flex-start" }}>
          <box style={{ writingMode: "vertical-rl", fontFamily: jp, fontSize: 18, lineHeight: 1.85, color: ink, height: 470 }}>
            日本語の文章は、昔から縦に書かれてきた。行は上から下へ進み、右から左へと重なっていく。新聞や小説、詩集の多くは、今も縦組みで印刷されている。2026年の今、Silk UIはこの組み方を画面の上で再現する。漢字と仮名は正立し、ラテン文字は横に倒れて流れる。句読点は行の中で位置を変え、読む目は自然に次の行へ移る。
          </box>
          <box style={{ writingMode: "vertical-rl", fontFamily: jp, fontWeight: 700, fontSize: 38, lineHeight: 1.2, color: accent, height: 470 }}>
            縦書きの美しさ
          </box>
        </box>
        <Tag>vertical-rl · lines flow right to left · Latin turns sideways</Tag>
      </box>
      <box style={{ ...column, gap: 12, justifyContent: "center", alignItems: "center" }}>
        <box style={{ writingMode: "vertical-rl", textOrientation: "upright", fontFamily: display, fontWeight: 700, fontSize: 30, lineHeight: 1, color: ink, height: 300 }}>
          SILK
        </box>
        <Tag>text-orientation: upright</Tag>
      </box>
    </box>
  );
}

const article =
  "ext does not have to sit in a rectangle. A float pulls a figure to one side and the lines beside it grow shorter to make room, then return to the full measure once they pass beneath it. Editors have used the effect for centuries: an initial letter cut deep into the first lines, a portrait set into a column, a seal stamped in the margin with the paragraph wrapping around its edge. The browser learned these tricks one property at a time, and a layout engine that wants to look at home on the web has to learn them too.";

const columns =
  "Columns let a long passage be read in short lines without leaving the page. The text fills the first column, breaks, and continues at the top of the next, with a rule between them. Magazines lean on it for sidebars and briefs like this one, where a single measure across the whole page would make the eye travel too far. The same text, set in one column, would simply run on.";

function Shapes() {
  return (
    <box style={{ ...column, flexGrow: 1 }}>
      <Headline number="03" kicker="Floats and columns">
        Around shapes
      </Headline>
      <box style={{ ...row, gap: 32, flexGrow: 1 }}>
        <box style={{ ...column, gap: 12, flexGrow: 3, flexBasis: 0 }}>
          <box style={{ ...body, textAlign: "justify" }}>
            <box style={{ float: "left", fontFamily: display, fontWeight: 700, fontSize: 92, lineHeight: 0.8, color: accent, marginTop: 6, marginRight: 10 }}>T</box>
            <box
              style={{
                float: "right",
                shapeOutside: "circle(50%)",
                width: 150,
                height: 150,
                borderRadius: 75,
                marginLeft: 18,
                marginBottom: 6,
                backgroundColor: ink,
                ...column,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <box style={{ fontFamily: jp, fontWeight: 700, fontSize: 64, lineHeight: 1, color: paper }}>活</box>
            </box>
            {article}
          </box>
          <box style={{ ...row, gap: 8 }}>
            <Tag>float: left · drop cap</Tag>
            <Tag>float: right · shape-outside: circle()</Tag>
            <Tag>text-align: justify</Tag>
          </box>
        </box>
        <box style={{ ...column, gap: 12, flexGrow: 2, flexBasis: 0, ...rule }}>
          <box style={{ fontFamily: sans, fontWeight: 600, fontSize: 12, color: muted }}>IN BRIEF</box>
          <box style={{ ...body, fontSize: 13.5, lineHeight: 1.55, columnCount: 2, columnGap: 22, columnRule: "1px solid " + hairline }}>{columns}</box>
          <Tag>column-count: 2 · column-rule</Tag>
        </box>
      </box>
    </box>
  );
}

const specimens = [
  { script: "Devanagari", sample: "क्षत्रिय", text: "हिन्दी में संयुक्ताक्षर जैसे क्ष, त्र और ज्ञ अक्षरों को जोड़कर बनते हैं।", tag: "conjuncts and vowel signs" },
  { script: "Thai", sample: "ภาษาไทย", text: "ภาษาไทยเขียนต่อกันโดยไม่เว้นวรรคระหว่างคำจึงต้องตัดบรรทัดตามคำ", tag: "line breaks without spaces" },
  { script: "Hangul", sample: "한글", text: "한글은 자음과 모음을 모아 음절 단위로 씁니다.", tag: "syllable blocks" },
  { script: "Greek · Cyrillic", sample: "Ωω Жж", text: "Ἐν ἀρχῇ ἦν ὁ λόγος. Съешь же ещё этих мягких булок.", tag: "polytonic accents" },
  { script: "Emoji", sample: "👩🏽‍🚀 🇯🇵 🧑‍🤝‍🧑", text: "Skin tones 👋🏻 👋🏽 👋🏿, flags 🇧🇷 🇰🇪 and joined sequences ❤️‍🔥 🏳️‍🌈", tag: "ZWJ sequences, flags, skin tones" },
  { script: "Kanji · Kana", sample: "永", text: "永字八法。一つの字に、書道の八つの筆法がすべて含まれている。", tag: "ideographs and kana" },
];

function Specimens() {
  return (
    <box style={{ ...column, flexGrow: 1 }}>
      <Headline number="04" kicker="Specimens" aside={<box style={{ fontFamily: serif, fontStyle: "italic", fontSize: 16, color: muted, paddingBottom: 4 }}>Shaping, clusters and line breaking</box>}>
        Six scripts
      </Headline>
      <box style={{ ...row, flexWrap: "wrap", gap: 18, flexGrow: 1 }}>
        {specimens.map((item) => (
          <box key={item.script} style={{ ...column, gap: 8, boxSizing: "border-box", width: 308, height: 208, padding: "14px 16px", borderWidth: 1, borderStyle: "solid", borderColor: hairline, borderRadius: 4 }}>
            <box style={{ ...row, justifyContent: "space-between", alignItems: "center" }}>
              <box style={{ fontFamily: sans, fontWeight: 600, fontSize: 12, color: ink }}>{item.script}</box>
              <box style={{ fontFamily: mono, fontSize: 10, color: accent }}>{item.tag}</box>
            </box>
            <box style={{ fontFamily: serif, fontSize: 44, lineHeight: 1.35, color: ink }}>{item.sample}</box>
            <box style={{ fontFamily: serif, fontSize: 15, lineHeight: 1.6, color: muted }}>{item.text}</box>
          </box>
        ))}
      </box>
    </box>
  );
}

const spreads = [
  ["Cover", Cover],
  ["Two directions", Bidi],
  ["Top to bottom", Vertical],
  ["Around shapes", Shapes],
  ["Specimens", Specimens],
];

export function App() {
  const [index, setIndex] = useState(0);
  const Spread = spreads[index][1];
  const go = (next) => setIndex((next + spreads.length) % spreads.length);
  return (
    <box
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") go(index + 1);
        if (event.key === "ArrowLeft") go(index - 1);
      }}
      style={{ ...column, position: "absolute", inset: 0, overflow: "hidden", backgroundColor: paper, color: ink, fontFamily: serif }}
    >
      <box style={{ ...row, justifyContent: "center", alignItems: "center", height: 56, flexShrink: 0, gap: 12, fontFamily: mono, fontSize: 11, color: muted }}>
        <box style={{ fontFamily: display, fontStyle: "italic", fontSize: 19, color: ink }}>Letterform</box>
        <box>·</box>
        <box>Issue 07</box>
        <box>·</box>
        <box>The Shape of Words</box>
      </box>
      <box style={{ ...column, flexGrow: 1, padding: "4px 40px 18px" }}>
        <Spread />
      </box>
      <box style={{ ...row, alignItems: "center", justifyContent: "space-between", height: 44, flexShrink: 0, padding: "0 40px", borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: hairline }}>
        <box style={{ ...row, gap: 22 }}>
          {spreads.map(([title], i) => (
            <box
              key={title}
              testId={"spread-" + i}
              cursor="pointer"
              onClick={() => go(i)}
              style={{ ...row, gap: 6, fontFamily: sans, fontSize: 12, color: i === index ? ink : muted, paddingTop: 4, paddingBottom: 4, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: i === index ? accent : "rgba(0, 0, 0, 0)" }}
              hoverStyle={{ color: ink }}
            >
              <box style={{ fontFamily: mono, fontSize: 10, color: accent }}>{"0" + i}</box>
              <box>{title}</box>
            </box>
          ))}
        </box>
        <box style={{ fontFamily: mono, fontSize: 10, color: muted }}>Set in Noto Serif and Geist · {index + 1} / {spreads.length}</box>
      </box>
    </box>
  );
}
