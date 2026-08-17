"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DATASET, TOPIC_KEYS, buildQuestions, type DictQuestion, type TopicKey } from "@/lib/dictation-data";
import "./dictation.css";

type Screen = "topics" | "game" | "result";

interface AnswerLog {
  questionNumber: number;
  sentence: string;
  fullSentence: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  tip: string;
}

const TOPIC_BTNS: { key: TopicKey | "all"; emoji: string; desc: string; highlight?: boolean }[] = [
  { key: "relationships", emoji: "❤️", desc: "10 ข้อ • คำศัพท์ความสัมพันธ์ & คำนามพหูพจน์ (-s)" },
  { key: "coffee", emoji: "☕", desc: "10 ข้อ • ประวัติกาแฟ & กริยาช่อง 2/3 (-ed)" },
  { key: "smiley", emoji: "😊", desc: "10 ข้อ • คำศัพท์หน้ายิ้ม & รูปแบบคำ (Word forms)" },
  { key: "chillies", emoji: "🌶️", desc: "10 ข้อ • พริก อาหารเผ็ด & ขั้นสูงสุด (-est)" },
  { key: "all", emoji: "🔥", desc: "ฝึกจำลองสอบสุ่มข้อจากทุกบทเรียน", highlight: true },
];

function renderSentence(sentence: string, mode: "blank" | "fill", fill?: string): React.ReactNode {
  const parts = sentence.split("________");
  const mid =
    mode === "blank" ? (
      <span className="blank-placeholder">________</span>
    ) : (
      <u>
        <strong>{fill || ""}</strong>
      </u>
    );
  return (
    <span>
      {parts[0]}
      {mid}
      {parts.slice(1).join("")}
    </span>
  );
}

function supportsSpeech(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export default function DictationPage() {
  const [screen, setScreen] = useState<Screen>("topics");
  const [examMode, setExamMode] = useState(true);
  const [speed, setSpeed] = useState(0.9);
  const [questions, setQuestions] = useState<DictQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [listenCount, setListenCount] = useState(0);
  const [input, setInput] = useState("");
    const [inputErr, setInputErr] = useState(false);
    // Structured feedback (never raw HTML) so user content can't inject markup.
    interface Feedback {
      ok: boolean;
      tip: string;
      userInput: string;
      correctAnswer: string;
      finalSoundWarning: string;
    }
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    // Non-blocking live region for alerts (listen-limit, unsupported TTS), so we
    // never call window.alert() which locks the tab and isn't screen-reader friendly.
    const [notice, setNotice] = useState<string | null>(null);
    const noticeTimer = useRef<number | null>(null);
  const [log, setLog] = useState<AnswerLog[]>([]);
  const [started, setStarted] = useState(false);

  const currentTopicRef = useRef<TopicKey | "all">("relationships");

  const q = questions[index];
  const maxListens = examMode ? 2 : 999;
  const total = questions.length;
  const startedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const cancelSpeech = useCallback(() => {
    if (supportsSpeech()) window.speechSynthesis.cancel();
  }, []);

  const playAudio = useCallback(() => {
      const flash = (msg: string) => {
        setNotice(msg);
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
      };
      if (examMode && listenCount >= maxListens) {
        flash("โหมดสอบ: คุณฟังครบ 2 ครั้งแล้วสำหรับข้อนี้ครับ");
        return;
      }
      if (!supportsSpeech()) {
        flash("เบราว์เซอร์ของคุณไม่รองรับ Text-to-Speech กรุณาใช้ Chrome, Safari หรือ Edge");
        return;
      }
      if (!q) return;
    cancelSpeech();
    const utterance = new SpeechSynthesisUtterance(q.full_sentence);
    utterance.lang = "en-US";
    utterance.rate = speed;
    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Samantha"))
    );
    if (enVoice) utterance.voice = enVoice;
    window.speechSynthesis.speak(utterance);
    setListenCount((c) => c + 1);
  }, [examMode, listenCount, maxListens, q, speed, cancelSpeech]);

  // Auto-play audio on new question (once mounted).
  useEffect(() => {
    if (screen === "game" && q && startedRef.current) {
      const t = setTimeout(() => playAudio(), 300);
      return () => clearTimeout(t);
    }
  }, [screen, index, q, playAudio]);

  useEffect(() => {
      if (screen === "game") inputRef.current?.focus();
    }, [screen, index]);

    /* Clean up the notice timer on unmount so it never fires after teardown. */
    useEffect(() => {
      return () => {
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      };
    }, []);

  const startTopic = useCallback(
    (key: TopicKey | "all") => {
      const qs = buildQuestions(key);
      setQuestions(qs);
      setIndex(0);
      setScore(0);
      setLog([]);
      setListenCount(0);
      setFeedback(null);
      setInput("");
      setScreen("game");
      startedRef.current = true;
    },
    []
  );

  const submitAnswer = useCallback(() => {
      if (!q || !input.trim()) {
        setInputErr(true);
        return;
      }
      setInputErr(false);
      const userInput = input.trim();
    const isExactMatch = q.alt_answers.some((a) => a.toLowerCase() === userInput.toLowerCase());
    let isCorrect = isExactMatch;
    let finalSoundWarning = "";

    const cleanUser = userInput.toLowerCase();
    const cleanTarget = q.answer.toLowerCase();

    if (!isCorrect) {
      if (cleanTarget.endsWith("s") && cleanTarget.slice(0, -1) === cleanUser) {
        finalSoundWarning = `⚠️ ระวังเสียงท้าย: คำตอบคือ "${q.answer}" (คุณขาดเสียงท้าย -s)`;
      } else if (
        cleanTarget.endsWith("ed") &&
        (cleanTarget.slice(0, -2) === cleanUser || cleanTarget.slice(0, -1) === cleanUser)
      ) {
        finalSoundWarning = `⚠️ ระวังเสียงท้าย: คำตอบคือ "${q.answer}" (คุณขาดเสียงท้าย -ed)`;
      } else if (cleanTarget.endsWith("es") && cleanTarget.slice(0, -2) === cleanUser) {
        finalSoundWarning = `⚠️ ระวังเสียงท้าย: คำตอบคือ "${q.answer}" (คุณขาดเสียงท้าย -es)`;
      }
    }

    if (isCorrect) setScore((s) => s + 1);

    const newLog: AnswerLog = {
      questionNumber: index + 1,
      sentence: q.sentence,
      fullSentence: q.full_sentence,
      userAnswer: userInput,
      correctAnswer: q.answer,
      isCorrect,
      tip: q.tip,
    };
    setLog((l) => [...l, newLog]);

    setFeedback({
          ok: isCorrect,
          tip: q.tip,
          userInput,
          correctAnswer: q.answer,
          finalSoundWarning,
        });
      }, [q, input, index]);

  const nextQuestion = useCallback(() => {
    cancelSpeech();
        setFeedback(null);
        setInput("");
        setInputErr(false);
        setListenCount(0);
    if (index + 1 < total) {
      setIndex((i) => i + 1);
    } else {
      setScreen("result");
    }
  }, [index, total, cancelSpeech]);

  const restart = useCallback(() => {
    cancelSpeech();
    startTopic(currentTopicRef.current);
  }, [startTopic, cancelSpeech]);

  const backToTopics = useCallback(() => {
    cancelSpeech();
    setScreen("topics");
  }, [cancelSpeech]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        if (screen === "game") {
          if (feedback) nextQuestion();
          else submitAnswer();
        }
      }
    },
    [screen, feedback, submitAnswer, nextQuestion]
  );

  const percent = total ? (score / total) * 100 : 0;
  const resultMsg =
    percent === 100
      ? { text: "🌟 ยอดเยี่ยมมาก! คุณสะกดถูกต้องและเก็บเสียงท้ายครบทุกข้อ", color: "var(--success)" }
      : percent >= 80
        ? { text: "👍 ทำได้ดีมาก! มีข้อผิดพลาดเล็กน้อย ลองทบทวนจุดที่ผิดด้านล่างนะครับ", color: "var(--primary)" }
        : { text: "💪 สู้ๆ ครับ! ลองฝึกทบทวนเสียงลงท้าย -s, -ed และฝึกฟังอีกรอบนะ", color: "var(--accent)" };

  return (
    <div className="dict-container">
      {screen === "topics" && (
        <>
          <div className="dict-header">
            <div>
              <h1>🦻 ฝึกฟังเสียงท้าย -s / -ed</h1>
              <div className="topic-desc">
                เลือกบทเรียน แล้วกดฟังเสียง ใส่คำที่หายไป (มีโหมดสอบจำกัดฟัง 2 ครั้ง และโหมดฝึกซ้อมฟังได้เรื่อยๆ)
              </div>
            </div>
          </div>
          <div className="mode-select">
            <label>โหมด</label>
            <select
              value={examMode ? "exam" : "practice"}
              onChange={(e) => setExamMode(e.target.value === "exam")}
              style={{ padding: "8px 12px", borderRadius: 8, border: "2px solid var(--border)", background: "#fff" }}
            >
              <option value="exam">โหมดสอบ (ฟังได้ 2 ครั้ง)</option>
              <option value="practice">โหมดฝึกซ้อม (ฟังได้เรื่อยๆ)</option>
            </select>
          </div>
          <div className="grid-topics" style={{ marginTop: 20 }}>
            {TOPIC_BTNS.map((t) => (
              <button
                key={t.key}
                className="topic-btn"
                style={t.highlight ? { borderColor: "var(--primary)", background: "var(--primary-light)" } : undefined}
                onClick={() => {
                  currentTopicRef.current = t.key;
                  startTopic(t.key);
                }}
              >
                <div className="topic-title">
                  {t.key === "all" ? "🎲 รวมทุกบท (Random 40 ข้อ) " : ""}
                  {t.key === "all" ? "🔥" : `${TOPIC_BTNS.find((x) => x.key === t.key)?.emoji || ""}`}
                  {t.key !== "all" && (
                    <>
                      {t.key === "relationships" && "1. Relationships "}
                      {t.key === "coffee" && "2. Ethiopian Coffee "}
                      {t.key === "smiley" && "3. Smiley Face "}
                      {t.key === "chillies" && "4. Chillies "}
                      {t.emoji}
                    </>
                  )}
                </div>
                <div className="topic-desc">{t.desc}</div>
              </button>
            ))}
            {TOPIC_KEYS.map(
              (k) =>
                DATASET[k] && (
                  <div key={k} hidden>
                    {DATASET[k].description}
                  </div>
                )
            )}
          </div>
        </>
      )}

      {screen === "game" && q && (
        <div onKeyDown={handleKey}>
          <div className="game-header">
            <span className="topic-tag">{q.topicTitle}</span>
            <span className="progress-info">
              ข้อ {index + 1} / {total}
            </span>
          </div>

          <div className="audio-control-box" style={{ background: "var(--primary-gradient, linear-gradient(135deg,#4f46e5,#6366f1))" }}>
            <button
                          className="play-btn"
                          onClick={playAudio}
                          aria-label={examMode ? "ฟังเสียง (เหลือ " + Math.max(0, maxListens - listenCount) + " ครั้ง)" : "ฟังเสียง"}
                          title="กดเพื่อฟังเสียงประโยค"
                        >
                          🔊
                        </button>
                        <div className="listen-count" id="listen-counter" style={{ color: "#fff" }}>
                          {examMode
                            ? `ฟังไปแล้ว ${listenCount} / ${maxListens} ครั้ง`
                            : `โหมดฝึกซ้อม: ฟังไปแล้ว ${listenCount} ครั้ง (กดฟังได้เรื่อยๆ)`}
                        </div>
                        {notice && (
                          <div className="notice" role="status" aria-live="polite">
                            {notice}
                          </div>
                        )}
            <div className="speed-controls">
              {[0.7, 0.9, 1.0, 1.25].map((s) => (
                <button
                  key={s}
                  className={"speed-btn" + (speed === s ? " active" : "")}
                  onClick={() => {
                    setSpeed(s);
                    cancelSpeech();
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          <div className="sentence-display" id="sentence-box">
            {index + 1}. {renderSentence(q.sentence, "blank")}
          </div>

          <div className="input-group">
                      <label htmlFor="user-input">พิมพ์คำตอบ (เป็นเสียงที่คุณได้ยิน):</label>
                      <input
                        ref={inputRef}
                        id="user-input"
                        className={"text-input" + (inputErr ? " err" : "")}
                        value={input}
                        disabled={!!feedback}
                        onChange={(e) => {
                          setInput(e.target.value);
                          if (inputErr) setInputErr(false);
                        }}
                        placeholder="พิมพ์คำตอบที่นี่…"
                        aria-invalid={inputErr || undefined}
                        aria-describedby={inputErr ? "input-hint" : undefined}
                      />
                      {inputErr && (
                        <div id="input-hint" className="input-hint" role="alert">
                          ⚠️ กรุณาพิมพ์คำตอบก่อนส่งครับ
                        </div>
                      )}
                    </div>

          {!feedback ? (
            <button className="btn btn-primary" onClick={submitAnswer}>
              ตรวจคำตอบ (Submit) ✓
            </button>
          ) : (
            <>
              <div className={`feedback-area ${feedback.ok ? "correct" : "incorrect"}`}>
                <div className="fb-title">{feedback.ok ? "✅ ถูกต้อง! (Correct)" : "❌ ยังไม่ถูกต้อง (Incorrect)"}</div>
                <div className="fb-details">
                  {feedback.ok ? (
                    <div>คำตอบของคุณ: <strong>{feedback.userInput}</strong></div>
                  ) : (
                    <div>
                      <div>
                        คำตอบที่คุณพิมพ์:{" "}
                        <s>{feedback.userInput || "(ว่าง)"}</s>
                      </div>
                      <div>คำตอบที่ถูกต้องคือ: <strong>{feedback.correctAnswer}</strong></div>
                      {feedback.finalSoundWarning && (
                        <div>{feedback.finalSoundWarning}</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="fb-tip">
                  💡 <strong>คำอธิบาย/จุดสังเกต:</strong> {feedback.tip}
                  <br />
                  <em>ประโยคเต็ม: "{q.full_sentence}"</em>
                </div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={nextQuestion}>
                ข้อถัดไป (Next) ➔
              </button>
            </>
          )}
        </div>
      )}

      {screen === "result" && (
        <>
          <div className="game-header">
            <span className="topic-tag">ผลลัพธ์</span>
          </div>
          <div className="result-score" style={{ textAlign: "center", margin: "24px 0" }}>
            <div className="result-score-label">คะแนนของคุณ</div>
            <div className="result-score-text" style={{ fontSize: 44, fontWeight: 700 }}>
              {score} / {total}
            </div>
            <div className="result-message" style={{ color: resultMsg.color, marginTop: 8 }}>
              {resultMsg.text}
            </div>
          </div>

          <div className="review-container" style={{ marginTop: 20 }}>
            {log.map((l) => (
              <div key={l.questionNumber} className={`review-item ${l.isCorrect ? "pass" : "fail"}`}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  ข้อ {l.questionNumber}: {l.isCorrect ? "✅ ถูกต้อง" : "❌ ผิด"}
                </div>
                <div style={{ color: "#334155", marginBottom: 4 }}>
                  {renderSentence(l.sentence, "fill", l.correctAnswer)}
                </div>
                <div style={{ fontSize: "0.88rem" }}>
                  คำตอบของคุณ: <strong>{l.userAnswer || "(ว่าง)"}</strong> | เฉลย: <strong>{l.correctAnswer}</strong>
                </div>
                <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: 4 }}>💡 {l.tip}</div>
              </div>
            ))}
          </div>

          <div className="result-actions" style={{ display: "flex", gap: 12, marginTop: 24 }}>
            <button className="btn btn-secondary" onClick={restart}>
              🔁 เริ่มบทนี้ใหม่
            </button>
            <button className="btn btn-primary" onClick={backToTopics}>
              📚 เลือกบทอื่น
            </button>
          </div>
        </>
      )}
    </div>
  );
}