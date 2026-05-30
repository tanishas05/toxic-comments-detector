import { useState, useRef } from "react";
import axios from "axios";
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

const TOXIC_PATTERNS = [
  /\b(idiot|stupid|dumb|moron|fool|loser|pathetic)\b/gi,
  /\b(hate|despise|disgusting|disgusted)\b/gi,
  /\b(kill|die|death|dead|murder|threat)\b/gi,
  /\b(ugly|fat|worthless|useless|garbage|trash)\b/gi,
  /\b(shut up|get lost|go away|nobody cares)\b/gi,
  /\b(racist|sexist|bigot|nazi)\b/gi,
  /[!]{3,}|\b(wtf|stfu|gtfo|omfg)\b/gi,
  /\b(bekaar|bakwas|saala|haramzada|kamina|kameena|chutiya|gandu)\b/gi,
  /\b(gadha|ullu|pagal|bewakoof|nalayak|besharam|ghatiya)\b/gi,
  /teri\s+maa|tere\s+baap|behen\s+ke/gi,
];

function getHighlightedParts(text) {
  const indices = [];
  TOXIC_PATTERNS.forEach(p => {
    const re = new RegExp(p.source, p.flags); let m;
    while ((m = re.exec(text)) !== null) indices.push({ start: m.index, end: m.index + m[0].length });
  });
  indices.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const seg of indices) {
    if (merged.length && seg.start < merged[merged.length - 1].end)
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, seg.end);
    else merged.push({ ...seg });
  }
  const parts = []; let cursor = 0;
  for (const seg of merged) {
    if (cursor < seg.start) parts.push({ text: text.slice(cursor, seg.start), toxic: false });
    parts.push({ text: text.slice(seg.start, seg.end), toxic: true });
    cursor = seg.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), toxic: false });
  return parts;
}

function getLevel(conf, isToxic) {
  if (!isToxic || conf < 0.3) return { label: "Safe",            tier: 0, color: "#22c55e", muted: "#14532d", bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.2)"   };
  if (conf < 0.5)             return { label: "Mildly Toxic",    tier: 1, color: "#eab308", muted: "#713f12", bg: "rgba(234,179,8,0.08)",   border: "rgba(234,179,8,0.2)"   };
  if (conf < 0.75)            return { label: "Toxic",           tier: 2, color: "#f97316", muted: "#7c2d12", bg: "rgba(249,115,22,0.08)",  border: "rgba(249,115,22,0.2)"  };
  return                             { label: "Extremely Toxic", tier: 3, color: "#ef4444", muted: "#7f1d1d", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)"   };
}

const VERDICTS = [
  "No harmful language detected. Safe to publish.",
  "Minor negativity detected. May not require action.",
  "Harmful language found. Flag for review.",
  "Highly toxic. Remove immediately.",
];

const SAMPLES = [
  ["Safe",    "Thanks for sharing! Really appreciate your thoughtful response."],
  ["Mild",    "This is a bit annoying honestly."],
  ["Toxic",   "You are such an idiot, nobody cares about your stupid opinion."],
  ["Extreme", "I hate you, worthless garbage, shut up and go die."],
];

function Meter({ score, color }) {
  const pct = Math.round(score * 100);
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 16, color: "#6b7280", fontWeight: 500, letterSpacing: "0.04em" }}>Toxicity Score</span>
        <span style={{ fontSize: 32, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{pct}<span style={{ fontSize: 16, opacity: 0.5 }}>%</span></span>
      </div>
      <div style={{ height: 5, background: "#1f2937", borderRadius: 999 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 999, transition: "width 0.5s cubic-bezier(0.16,1,0.3,1)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "#374151", letterSpacing: "0.05em" }}>
        <span>SAFE</span><span>EXTREME</span>
      </div>
    </div>
  );
}

export default function App() {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("howitworks");
  const [history, setHistory] = useState([]);
  const [live, setLive] = useState(true);
  const [error, setError] = useState(null);
  const [bulkResults, setBulkResults] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkPaused, setBulkPaused] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const abortRef = useRef(null);
  const textareaRef = useRef(null);
  const bulkCancelledRef = useRef(false);
  const bulkPausedRef = useRef(false);

  const analyze = async (input, silent = false) => {
    if (!input.trim()) { setResult(null); return; }
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController(); abortRef.current = ctrl;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const res = await axios.post("https://toxic-comments-detector.onrender.com/predict", { text: input }, { signal: ctrl.signal });
      setResult(res.data);
      setHistory(prev => [{ text: input.slice(0, 120), result: res.data }, ...prev.filter(h => h.text !== input.slice(0, 120))].slice(0, 50));
    } catch (err) {
      if (axios.isCancel(err) || err.name === "CanceledError") return;
      if (!silent) setError("Backend unreachable. Run: uvicorn app:app --reload");
    } finally {
      if (!silent) setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyUp = e => { if (!live) return; if (e.key === " ") { const v = e.target.value.trim(); if (v) analyze(v, true); } };
  const handleKeyDown = e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); analyze(text); } };

  const extractLinesFromFile = async (file) => {
    if (file.name.endsWith(".pdf")) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        fullText += tc.items.map(i => i.str).join(" ") + "\n";
      }
      return fullText.split(/[.!?\n]+/).map(l => l.trim()).filter(l => l.length > 4);
    }
    const t = await file.text();
    return t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  };

  const handleBulkFile = async (file) => {
    const lines = await extractLinesFromFile(file);
    if (!lines.length) return;
    bulkCancelledRef.current = false;
    bulkPausedRef.current = false;
    setBulkResults([]); setBulkLoading(true); setBulkPaused(false); setBulkProgress(0); setBulkTotal(lines.length);
    const results = [];
    for (let i = 0; i < lines.length; i++) {
      if (bulkCancelledRef.current) break;
      // wait while paused
      while (bulkPausedRef.current && !bulkCancelledRef.current) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (bulkCancelledRef.current) break;
      const comment = lines[i];
      try {
        const res = await axios.post("https://tanishas05-wordikt-backend.hf.space/predict", { text: comment });
        results.push({ text: comment, result: res.data });
        setHistory(prev => [{ text: comment.slice(0, 120), result: res.data }, ...prev].slice(0, 50));
      } catch { results.push({ text: comment, result: null, error: "Failed" }); }
      setBulkResults([...results]);
      setBulkProgress(Math.round(((i + 1) / lines.length) * 100));
    }
    setBulkLoading(false);
    setBulkPaused(false);
  };

  const handleBulkPause = () => {
    bulkPausedRef.current = true;
    setBulkPaused(true);
  };

  const handleBulkResume = () => {
    bulkPausedRef.current = false;
    setBulkPaused(false);
  };

  const handleBulkCancel = () => {
    bulkCancelledRef.current = true;
    bulkPausedRef.current = false;
    setBulkLoading(false);
    setBulkPaused(false);
  };

  const exportCSV = (results) => {
    const rows = [["Comment", "Level", "Score", "Toxic"]];
    results.forEach(r => {
      const lv = r.result ? getLevel(r.result.confidence, r.result.toxic) : null;
      rows.push([`"${r.text.replace(/"/g, '""')}"`, lv ? lv.label : "Error", r.result ? Math.round(r.result.confidence * 100) + "%" : "—", r.result ? (r.result.toxic ? "Yes" : "No") : "—"]);
    });
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "results.csv"; a.click();
  };

  const level = result ? getLevel(result.confidence, result.toxic) : null;
  const parts = result && text ? getHighlightedParts(text) : null;
  const hasToxicWords = parts?.some(p => p.toxic);
  const total = history.length;
  const toxicCount = history.filter(h => h.result.toxic).length;
  const avgScore = total ? Math.round(history.reduce((s, h) => s + h.result.confidence, 0) / total * 100) : 0;
  const wordFreq = {};
  history.filter(h => h.result.toxic).forEach(h => {
    TOXIC_PATTERNS.forEach(p => { const re = new RegExp(p.source, p.flags); let m;
      while ((m = re.exec(h.text)) !== null) { const w = m[0].toLowerCase(); wordFreq[w] = (wordFreq[w] || 0) + 1; } });
  });
  const topWords = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const tierColors = ["#22c55e", "#eab308", "#f97316", "#ef4444"];
  const tierLabels = ["Safe", "Mildly Toxic", "Toxic", "Extremely Toxic"];
  const tierCounts = [0,1,2,3].map(t => history.filter(h => getLevel(h.result.confidence, h.result.toxic).tier === t).length);

  const TABS = [["howitworks", "How it works"], ["analyze", "Analyze"], ["bulk", "Bulk Upload"], ["dashboard", "Dashboard"]];

  return (
    <div style={{ minHeight: "100vh", background: "#111318", color: "#e4e7ed", fontFamily: "'Inter', system-ui, sans-serif", fontSize: 16 }}>

      {/* NAV — full width, items spread across */}
      <nav style={{ height: 58, borderBottom: "1px solid #1e2128", display: "flex", alignItems: "center", padding: "0 28px", gap: 0 }}>
        {/* Logo — left */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: "auto" }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2L3 5.5V10.5C3 14.1 6.1 17.4 10 18C13.9 17.4 17 14.1 17 10.5V5.5L10 2Z" fill="#1e2128" stroke="#4f46e5" strokeWidth="1.4"/>
            <path d="M7 10l2.5 2.5L13 9" stroke="#22c55e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#f3f4f6", letterSpacing: "-0.02em" }}>Wordikt</span>
        </div>

        {/* Tabs — center */}
        <div style={{ display: "flex", gap: 2, position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
          {TABS.map(([id, lbl]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ padding: "6px 18px", borderRadius: 7, fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer", transition: "all 0.18s", background: tab === id ? "#4f46e5" : "transparent", color: tab === id ? "#fff" : "#6b7280" }}
              onMouseEnter={e => { if (tab !== id) { e.currentTarget.style.background = "#1e2128"; e.currentTarget.style.color = "#e4e7ed"; } }}
              onMouseLeave={e => { if (tab !== id) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#6b7280"; } }}
            >{lbl}</button>
          ))}
        </div>

        {/* Live toggle — right */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginLeft: "auto" }}>
          <span style={{ fontSize: 14, color: live ? "#22c55e" : "#6b7280", fontWeight: 500 }}>Live</span>
          <div onClick={() => setLive(v => !v)} style={{ width: 34, height: 18, borderRadius: 999, background: live ? "#16a34a" : "#2d3139", cursor: "pointer", position: "relative", transition: "background 0.2s", border: "1px solid #374151" }}>
            <span style={{ position: "absolute", top: 2, left: live ? 17 : 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
          </div>
        </div>
      </nav>

      {/* ── HOW IT WORKS ── */}
      {tab === "howitworks" && (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px 60px" }}>
          <div style={{ marginBottom: 48 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "#4f46e5", letterSpacing: "0.07em", textTransform: "uppercase", margin: "0 0 12px" }}>How it works</p>
            <h1 style={{ fontSize: 32, fontWeight: 700, color: "#f3f4f6", margin: "0 0 14px", letterSpacing: "-0.03em", lineHeight: 1.2 }}>ML-powered toxicity detection</h1>
            <p style={{ fontSize: 15, color: "#6b7280", margin: 0, lineHeight: 1.7, maxWidth: 520 }}>
              Trained on 160,000+ real-world English and Hinglish comments using TF-IDF vectorization and a LinearSVC classifier.
            </p>
          </div>

          {/* Steps */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 32 }}>
            {[
              { n: "01", title: "You type a comment", desc: "In live mode, the model runs after every word you type. No button needed — just press space.", color: "#4f46e5" },
              { n: "02", title: "TF-IDF vectorises text", desc: "Your comment becomes a vector. Words rare in normal text but common in toxic comments get higher weight.", color: "#4f46e5" },
              { n: "03", title: "LinearSVC classifies", desc: "The vector is fed into a Support Vector Classifier trained on 160k+ labeled comments from Jigsaw + Hinglish datasets.", color: "#4f46e5" },
              { n: "04", title: "Score maps to a level", desc: "0–30% Safe. 30–50% Mildly Toxic. 50–75% Toxic. 75%+ Extremely Toxic. Harmful words highlighted in red.", color: "#4f46e5" },
            ].map(({ n, title, desc, color }) => (
              <div key={n} style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: "0.07em", marginBottom: 10 }}>{n}</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#f3f4f6", marginBottom: 8 }}>{title}</div>
                <p style={{ fontSize: 15, color: "#6b7280", margin: 0, lineHeight: 1.7 }}>{desc}</p>
              </div>
            ))}
          </div>

          {/* Model details */}
          <div style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e2128" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", letterSpacing: "0.07em", textTransform: "uppercase" }}>Model details</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
              {[
                { label: "Algorithm",     value: "LinearSVC"          },
                { label: "Vectorizer",    value: "TF-IDF char n-grams" },
                { label: "Training data", value: "160k+ comments"     },
                { label: "Dataset",       value: "Jigsaw + Hinglish"  },
                { label: "Accuracy",      value: "89.5%"              },
                { label: "Backend",       value: "FastAPI + sklearn"  },
              ].map(({ label, value }, i) => (
                <div key={label} style={{ padding: "16px 20px", borderRight: i % 3 !== 2 ? "1px solid #1e2128" : "none", borderBottom: i < 3 ? "1px solid #1e2128" : "none" }}>
                  <div style={{ fontSize: 11, color: "#4b5563", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "#e4e7ed" }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Levels */}
          <div style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e2128" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", letterSpacing: "0.07em", textTransform: "uppercase" }}>Toxicity levels</span>
            </div>
            {[
              { label: "Safe",            range: "0–30%",   color: "#22c55e", desc: "No harmful language. Safe to publish." },
              { label: "Mildly Toxic",    range: "30–50%",  color: "#eab308", desc: "Minor negativity. Worth monitoring." },
              { label: "Toxic",           range: "50–75%",  color: "#f97316", desc: "Harmful language. Flag for review." },
              { label: "Extremely Toxic", range: "75–100%", color: "#ef4444", desc: "Highly toxic. Remove immediately." },
            ].map(({ label, range, color, desc }, i) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", borderBottom: i < 3 ? "1px solid #1e2128" : "none" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 16, fontWeight: 600, color, width: 120, flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 11, color: "#4b5563", width: 70, flexShrink: 0 }}>{range}</span>
                <span style={{ fontSize: 15, color: "#6b7280" }}>{desc}</span>
              </div>
            ))}
          </div>

          {/* Limitations */}
          <div style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e2128" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", letterSpacing: "0.07em", textTransform: "uppercase" }}>Limitations</span>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                "Probabilistic — a high score does not guarantee toxicity, just statistical resemblance to toxic training data.",
                "Sarcasm and irony can fool the model. Tone-based toxicity may not trigger keyword highlights.",
                "Keyword highlighting uses regex, not the ML model — highlighted words may not be the actual cause of the score.",
                "Primarily trained on English. Hinglish accuracy improves with more labeled data.",
              ].map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 10 }}>
                  <span style={{ color: "#eab308", flexShrink: 0, marginTop: 1 }}>—</span>
                  <p style={{ fontSize: 15, color: "#6b7280", margin: 0, lineHeight: 1.7 }}>{t}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ANALYZE ── */}
      {tab === "analyze" && (
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 60px" }}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: "#f3f4f6", margin: "0 0 8px", letterSpacing: "-0.02em" }}>Analyze a comment</h1>
            <p style={{ fontSize: 15, color: "#6b7280", margin: 0 }}>{live ? "Updates after each word as you type." : "Press Ctrl+Enter to analyze."}</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: result ? "1fr 1fr" : "1fr", gap: 12, alignItems: "start" }}>
            {/* Input */}
            <div style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #1e2128", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", letterSpacing: "0.07em", textTransform: "uppercase" }}>Input</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {loading && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 0.8s linear infinite" }}><circle cx="12" cy="12" r="9" stroke="#2d3139" strokeWidth="2.5"/><path d="M12 3a9 9 0 0 1 9 9" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round"/></svg>}
                  <span style={{ fontSize: 11, color: loading ? "#4f46e5" : live ? "#22c55e" : "#6b7280" }}>{loading ? "analyzing…" : live ? "live" : "manual"}</span>
                </div>
              </div>
              <textarea ref={textareaRef} rows={8} value={text} onChange={e => setText(e.target.value)} onKeyUp={handleKeyUp} onKeyDown={handleKeyDown} placeholder="Type a comment…"
                style={{ width: "100%", boxSizing: "border-box", display: "block", background: "#111318", border: "none", borderBottom: "1px solid #1e2128", padding: "14px 16px", fontSize: 15, color: "#e4e7ed", lineHeight: 1.75, resize: "none", outline: "none", fontFamily: "inherit" }}
              />
              <div style={{ padding: "10px 16px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "#374151", marginRight: 4 }}>Try:</span>
                {SAMPLES.map(([lbl, sample]) => (
                  <button key={lbl} onClick={() => { setText(sample); if (live) analyze(sample, true); }}
                    style={{ padding: "3px 10px", borderRadius: 6, fontSize: 13, fontWeight: 500, background: "transparent", border: "1px solid #1e2128", color: "#6b7280", cursor: "pointer", transition: "all 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#4f46e5"; e.currentTarget.style.color = "#818cf8"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e2128"; e.currentTarget.style.color = "#6b7280"; }}
                  >{lbl}</button>
                ))}
                {text && <button onClick={() => { setText(""); setResult(null); textareaRef.current?.focus(); }} style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 6, fontSize: 13, background: "transparent", border: "1px solid #1e2128", color: "#4b5563", cursor: "pointer" }}>Clear</button>}
              </div>
              {!live && text && (
                <div style={{ padding: "0 12px 12px" }}>
                  <button onClick={() => analyze(text)} disabled={!text.trim() || loading} style={{ width: "100%", padding: 9, borderRadius: 8, fontSize: 16, fontWeight: 600, border: "none", cursor: !text.trim() || loading ? "not-allowed" : "pointer", background: !text.trim() || loading ? "#1e2128" : "#4f46e5", color: !text.trim() || loading ? "#374151" : "#fff", transition: "all 0.15s" }}>
                    Analyze <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 11 }}>Ctrl+Enter</span>
                  </button>
                </div>
              )}
              {error && <div style={{ margin: "0 12px 12px", padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", fontSize: 12 }}>{error}</div>}
            </div>

            {/* Result */}
            {result && level && (
              <div style={{ background: "#16181e", border: `1px solid ${level.border}`, borderRadius: 12, overflow: "hidden", animation: "fadeUp 0.25s ease both" }}>
                <div style={{ padding: "10px 16px", borderBottom: `1px solid ${level.border}`, background: level.bg, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: level.color }} />
                    <span style={{ fontSize: 16, fontWeight: 600, color: level.color }}>{level.label}</span>
                  </div>
                  <span style={{ fontSize: 11, color: level.color, opacity: 0.6 }}>{["No action", "Monitor", "Flag", "Remove"][level.tier]}</span>
                </div>
                <div style={{ padding: 18 }}>
                  <Meter score={result.confidence} color={level.color} />
                  {parts && (
                    <div style={{ marginBottom: 14 }}>
                      <p style={{ fontSize: 11, color: "#4b5563", fontWeight: 600, margin: "0 0 7px", textTransform: "uppercase", letterSpacing: "0.07em" }}>{hasToxicWords ? "Flagged words" : "Comment"}</p>
                      <div style={{ background: "#111318", border: "1px solid #1e2128", borderRadius: 8, padding: "10px 12px", fontSize: 16, lineHeight: 1.85, color: "#9ca3af" }}>
                        {parts.map((part, i) =>
                          part.toxic
                            ? <span key={i} style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", borderRadius: 4, padding: "1px 5px", border: "1px solid rgba(239,68,68,0.25)", fontWeight: 600 }}>{part.text}</span>
                            : <span key={i}>{part.text}</span>
                        )}
                      </div>
                      {!hasToxicWords && result.toxic && <p style={{ fontSize: 11, color: "#4b5563", margin: "6px 0 0" }}>Tone-based detection — no exact keyword matched.</p>}
                    </div>
                  )}
                  <p style={{ fontSize: 16, color: "#6b7280", lineHeight: 1.65, margin: 0 }}>{VERDICTS[level.tier]}</p>
                </div>
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <p style={{ fontSize: 11, color: "#4b5563", fontWeight: 600, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.07em" }}>Recent ({history.length})</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {history.slice(0, 5).map((h, i) => {
                  const lv = getLevel(h.result.confidence, h.result.toxic);
                  return (
                    <button key={i} onClick={() => { setText(h.text); setResult(h.result); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderRadius: 8, background: "#16181e", border: "1px solid #1e2128", cursor: "pointer", textAlign: "left", width: "100%", transition: "border-color 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "#2d3139"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "#1e2128"}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: lv.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 16, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.text}</span>
                      <span style={{ fontSize: 16, fontWeight: 600, color: lv.color, flexShrink: 0 }}>{lv.label}</span>
                      <span style={{ fontSize: 11, color: "#374151", flexShrink: 0 }}>{Math.round(h.result.confidence * 100)}%</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── BULK ── */}
      {tab === "bulk" && (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px 60px" }}>
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: "#f3f4f6", margin: "0 0 8px", letterSpacing: "-0.02em" }}>Bulk upload</h1>
            <p style={{ fontSize: 15, color: "#6b7280", margin: 0 }}>Upload a .txt, .csv, or .pdf file. One comment per line for text files. PDFs are split into sentences automatically.</p>
          </div>

          <label htmlFor="bulk-file" style={{ display: "block", marginBottom: 20, cursor: "pointer" }}>
            <div style={{ border: "1px dashed #2d3139", borderRadius: 12, padding: "36px 24px", textAlign: "center", background: "#16181e", transition: "border-color 0.2s" }}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#4f46e5"; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = "#2d3139"; }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#2d3139"; const file = e.dataTransfer.files[0]; if (file) handleBulkFile(file); }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ margin: "0 auto 12px", display: "block" }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="#4f46e5" strokeWidth="1.6" strokeLinecap="round"/>
                <polyline points="17 8 12 3 7 8" stroke="#4f46e5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="12" y1="3" x2="12" y2="15" stroke="#4f46e5" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              <p style={{ fontSize: 16, fontWeight: 600, color: "#e4e7ed", margin: "0 0 4px" }}>Drop your file here</p>
              <p style={{ fontSize: 15, color: "#4b5563", margin: "0 0 14px" }}>or click to browse — .txt  .csv  .pdf</p>
              <span style={{ padding: "7px 18px", borderRadius: 7, background: "#4f46e5", color: "#fff", fontSize: 16, fontWeight: 600 }}>Choose file</span>
            </div>
          </label>
          <input id="bulk-file" type="file" accept=".txt,.csv,.pdf" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) handleBulkFile(e.target.files[0]); e.target.value = ""; }} />

          {bulkLoading && (
            <div style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 10, padding: "16px 20px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {bulkPaused
                    ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#eab308" }} />
                    : <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4f46e5", animation: "pulse 1.2s ease infinite" }} />
                  }
                  <span style={{ fontSize: 14, color: "#9ca3af" }}>
                    {bulkPaused ? "Paused" : "Analyzing…"} {bulkResults.length} / {bulkTotal}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#4f46e5", marginRight: 8 }}>{bulkProgress}%</span>
                  {bulkPaused ? (
                    <button onClick={handleBulkResume} style={{ padding: "5px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: "#4f46e5", color: "#fff", transition: "all 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#4338ca"}
                      onMouseLeave={e => e.currentTarget.style.background = "#4f46e5"}
                    >Resume</button>
                  ) : (
                    <button onClick={handleBulkPause} style={{ padding: "5px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "1px solid #2d3139", cursor: "pointer", background: "transparent", color: "#9ca3af", transition: "all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#eab308"; e.currentTarget.style.color = "#eab308"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "#2d3139"; e.currentTarget.style.color = "#9ca3af"; }}
                    >Pause</button>
                  )}
                  <button onClick={handleBulkCancel} style={{ padding: "5px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "1px solid #2d3139", cursor: "pointer", background: "transparent", color: "#9ca3af", transition: "all 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.color = "#f87171"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#2d3139"; e.currentTarget.style.color = "#9ca3af"; }}
                  >Cancel</button>
                </div>
              </div>
              <div style={{ height: 4, background: "#1e2128", borderRadius: 999 }}>
                <div style={{ height: "100%", width: `${bulkProgress}%`, background: bulkPaused ? "#eab308" : "#4f46e5", borderRadius: 999, transition: "width 0.3s" }} />
              </div>
            </div>
          )}

          {bulkResults.length > 0 && !bulkLoading && (() => {
            const tb = bulkResults.filter(r => r.result?.toxic).length;
            const sb = bulkResults.length - tb;
            const ab = Math.round(bulkResults.filter(r => r.result).reduce((s, r) => s + r.result.confidence, 0) / bulkResults.filter(r => r.result).length * 100);
            return (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
                  {[{ label: "Total", value: bulkResults.length, color: "#818cf8" }, { label: "Toxic", value: tb, color: "#f87171" }, { label: "Safe", value: sb, color: "#4ade80" }, { label: "Avg Score", value: `${ab}%`, color: "#facc15" }].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 10, padding: "14px 16px" }}>
                      <p style={{ fontSize: 11, color: "#4b5563", margin: "0 0 6px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
                      <p style={{ fontSize: 24, fontWeight: 700, color, margin: 0 }}>{value}</p>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <p style={{ fontSize: 11, color: "#4b5563", fontWeight: 600, margin: 0, textTransform: "uppercase", letterSpacing: "0.07em" }}>Results ({bulkResults.length})</p>
                  <button onClick={() => exportCSV(bulkResults)} style={{ padding: "6px 14px", borderRadius: 7, fontSize: 16, fontWeight: 500, background: "transparent", border: "1px solid #2d3139", color: "#6b7280", cursor: "pointer" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#4f46e5"; e.currentTarget.style.color = "#818cf8"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#2d3139"; e.currentTarget.style.color = "#6b7280"; }}
                  >Export CSV</button>
                </div>
              </div>
            );
          })()}

          {bulkResults.length > 0 && (
            <div style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 70px", padding: "9px 18px", borderBottom: "1px solid #1e2128", background: "#111318" }}>
                {["Comment", "Level", "Score"].map(h => <span key={h} style={{ fontSize: 10, color: "#374151", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</span>)}
              </div>
              <div style={{ maxHeight: 460, overflowY: "auto" }}>
                {bulkResults.map((row, i) => {
                  const lv = row.result ? getLevel(row.result.confidence, row.result.toxic) : null;
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px 70px", padding: "11px 18px", borderBottom: i < bulkResults.length - 1 ? "1px solid #1e2128" : "none", alignItems: "center", transition: "background 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1a1c23"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{ fontSize: 16, color: row.error ? "#f87171" : "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 14 }}>{row.error ? `Error: ${row.error}` : row.text}</span>
                      {lv ? <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: lv.color }} /><span style={{ fontSize: 16, fontWeight: 600, color: lv.color }}>{lv.label}</span></div> : <span style={{ fontSize: 15, color: "#374151" }}>—</span>}
                      <span style={{ fontSize: 16, fontWeight: 600, color: lv ? lv.color : "#374151", textAlign: "right" }}>{row.result ? `${Math.round(row.result.confidence * 100)}%` : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {bulkResults.length === 0 && !bulkLoading && (
            <div style={{ textAlign: "center", padding: "40px 24px", background: "#16181e", border: "1px solid #1e2128", borderRadius: 12, color: "#374151" }}>
              <p style={{ fontSize: 16, margin: "0 0 4px", fontWeight: 500, color: "#6b7280" }}>No file uploaded yet</p>
              <p style={{ fontSize: 16, margin: 0 }}>Supports .txt and .csv (one comment per line) or .pdf</p>
            </div>
          )}
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {tab === "dashboard" && (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px 60px" }}>
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: "#f3f4f6", margin: "0 0 8px", letterSpacing: "-0.02em" }}>Dashboard</h1>
            <p style={{ fontSize: 15, color: "#6b7280", margin: 0 }}>{total === 0 ? "No comments analyzed yet." : `${total} comment${total !== 1 ? "s" : ""} this session.`}</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
            {[{ label: "Total", value: total, color: "#e4e7ed" }, { label: "Toxic", value: toxicCount, color: "#f87171" }, { label: "Safe", value: total - toxicCount, color: "#4ade80" }, { label: "Avg Score", value: `${avgScore}%`, color: "#eab308" }].map(({ label, value, color }) => (
              <div key={label} style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 10, padding: "16px 18px" }}>
                <p style={{ fontSize: 11, color: "#4b5563", margin: "0 0 8px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
                <p style={{ fontSize: 26, fontWeight: 700, color, margin: 0, letterSpacing: "-0.02em" }}>{value}</p>
              </div>
            ))}
          </div>

          {total > 0 && (
            <div style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 12, padding: "18px 20px", marginBottom: 12 }}>
              <p style={{ fontSize: 11, color: "#4b5563", fontWeight: 600, margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.07em" }}>Breakdown</p>
              {tierLabels.map((label, tier) => (
                <div key={tier} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 16, color: "#6b7280", width: 120, flexShrink: 0 }}>{label}</span>
                  <div style={{ flex: 1, height: 5, background: "#1e2128", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: tierColors[tier], borderRadius: 999, width: `${total ? (tierCounts[tier] / total) * 100 : 0}%`, transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)" }} />
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 600, color: tierColors[tier], width: 20, textAlign: "right", flexShrink: 0 }}>{tierCounts[tier]}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 12, padding: "18px 20px", marginBottom: 12 }}>
            <p style={{ fontSize: 11, color: "#4b5563", fontWeight: 600, margin: "0 0 14px", textTransform: "uppercase", letterSpacing: "0.07em" }}>Most flagged terms</p>
            {topWords.length === 0
              ? <p style={{ fontSize: 15, color: "#374151", margin: 0 }}>No toxic terms logged yet.</p>
              : <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {topWords.map(([word, count]) => (
                    <div key={word} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <code style={{ fontSize: 15, color: "#9ca3af", width: 100, textAlign: "right", flexShrink: 0 }}>{word}</code>
                      <div style={{ flex: 1, height: 4, background: "#1e2128", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(count / topWords[0][1]) * 100}%`, background: "#ef4444", borderRadius: 999, transition: "width 0.6s" }} />
                      </div>
                      <span style={{ fontSize: 11, color: "#374151", width: 20, flexShrink: 0 }}>{count}x</span>
                    </div>
                  ))}
                </div>
            }
          </div>

          {history.length > 0 && (
            <div style={{ background: "#16181e", border: "1px solid #1e2128", borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: "#4b5563", fontWeight: 600, margin: 0, textTransform: "uppercase", letterSpacing: "0.07em" }}>Comment log</p>
                <button onClick={() => { setHistory([]); setResult(null); }} style={{ fontSize: 15, color: "#374151", background: "none", border: "none", cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.color = "#f87171"}
                  onMouseLeave={e => e.currentTarget.style.color = "#374151"}
                >Clear all</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 280, overflowY: "auto" }}>
                {history.map((h, i) => {
                  const lv = getLevel(h.result.confidence, h.result.toxic);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 7, background: "#111318" }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: lv.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 16, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.text}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: lv.color, flexShrink: 0 }}>{lv.label}</span>
                      <span style={{ fontSize: 11, color: "#374151", flexShrink: 0 }}>{Math.round(h.result.confidence * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}


      {/* Footer */}
      <footer style={{ borderTop: "1px solid #1e2128", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 14, color: "#374151" }}>
          Built by <span style={{ color: "#e4e7ed", fontWeight: 600 }}>Tanisha Sharma</span> · Wordikt © 2025
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <a href="https://github.com/tanishas05" target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#6b7280", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.color = "#e4e7ed"}
            onMouseLeave={e => e.currentTarget.style.color = "#6b7280"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>
            GitHub
          </a>
          <a href="https://www.linkedin.com/in/tanishas05/" target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#6b7280", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.color = "#0a66c2"}
            onMouseLeave={e => e.currentTarget.style.color = "#6b7280"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            LinkedIn
          </a>
        </div>
      </footer>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        * { box-sizing: border-box; }
        body { margin: 0; background: #111318; }
        textarea { caret-color: #4f46e5; }
        textarea::placeholder { color: #2d3139; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #1e2128; border-radius: 2px; }
      `}</style>
    </div>
  );
}