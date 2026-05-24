import { useState, useRef } from "react";
import axios from "axios";

const TOXIC_PATTERNS = [
  /\b(idiot|stupid|dumb|moron|fool|loser|pathetic)\b/gi,
  /\b(hate|despise|disgusting|disgusted)\b/gi,
  /\b(kill|die|death|dead|murder|threat)\b/gi,
  /\b(ugly|fat|worthless|useless|garbage|trash)\b/gi,
  /\b(shut up|get lost|go away|nobody cares)\b/gi,
  /\b(racist|sexist|bigot|nazi)\b/gi,
  /[!]{3,}|\b(wtf|stfu|gtfo|omfg)\b/gi,
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
  if (!isToxic || conf < 0.3) return { label: "Safe",            tier: 0, color: "#4ade80", dark: "#166534", glow: "rgba(74,222,128,0.2)"  };
  if (conf < 0.5)             return { label: "Mildly Toxic",    tier: 1, color: "#facc15", dark: "#713f12", glow: "rgba(250,204,21,0.2)"  };
  if (conf < 0.75)            return { label: "Toxic",           tier: 2, color: "#fb923c", dark: "#7c2d12", glow: "rgba(251,146,60,0.2)"  };
  return                             { label: "Extremely Toxic", tier: 3, color: "#f87171", dark: "#7f1d1d", glow: "rgba(248,113,113,0.2)" };
}

const VERDICTS = [
  "No harmful language detected. Safe to publish.",
  "Minor negativity detected. Probably fine, keep an eye on it.",
  "Harmful language found. Flag this comment for review.",
  "Highly toxic. Remove immediately.",
];

const SAMPLES = [
  ["Safe",    "Thanks for sharing! Really appreciate your thoughtful response."],
  ["Mild",    "This is a bit annoying honestly."],
  ["Toxic",   "You are such an idiot, nobody cares about your stupid opinion."],
  ["Extreme", "I hate you, worthless garbage, shut up and go die."],
];

const C = {
  bg:     "#080d1a",
  card:   "#0e1525",
  border: "#1a2540",
  border2:"#243050",
  txt:    "#e2eaf8",
  txt2:   "#7b8dab",
  txt3:   "#3d4f6e",
};

function Meter({ score, color, glow }) {
  const pct = Math.round(score * 100);
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
        <span style={{ fontSize:13, color:C.txt2, fontWeight:600, letterSpacing:"0.05em", textTransform:"uppercase" }}>Toxicity Score</span>
        <span style={{ fontSize:38, fontWeight:900, color, letterSpacing:"-0.04em", lineHeight:1,  }}>{pct}<span style={{ fontSize:18, opacity:0.6 }}>%</span></span>
      </div>
      <div style={{ height:8, background:C.border, borderRadius:999, overflow:"hidden", boxShadow:`inset 0 0 0 1px ${C.border2}` }}>
        <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:999, transition:"width 0.6s cubic-bezier(0.16,1,0.3,1)" }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontSize:11, color:C.txt3 }}>
        <span>Safe</span><span>Extreme</span>
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
  const [bulkProgress, setBulkProgress] = useState(0);
  const abortRef = useRef(null);
  const textareaRef = useRef(null);

  const analyze = async (input, silent = false) => {
    if (!input.trim()) { setResult(null); return; }
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController(); abortRef.current = ctrl;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const res = await axios.post("http://127.0.0.1:8000/predict", { text: input }, { signal: ctrl.signal });
      setResult(res.data);
      setHistory(prev => [{ text: input.slice(0, 120), result: res.data }, ...prev.filter(h => h.text !== input.slice(0, 120))].slice(0, 50));
    } catch (err) {
      if (axios.isCancel(err) || err.name === "CanceledError") return;
      if (!silent) setError("Backend unreachable. Start FastAPI on port 8000.");
    } finally {
      if (!silent) setLoading(false);
      textareaRef.current?.focus();
    }
  };


  const handleBulkFile = async (file) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setBulkResults([]);
    setBulkLoading(true);
    setBulkProgress(0);
    const results = [];
    for (let i = 0; i < lines.length; i++) {
      const comment = lines[i];
      try {
        const res = await axios.post("http://127.0.0.1:8000/predict", { text: comment });
        results.push({ text: comment, result: res.data });
        setHistory(prev => [{ text: comment.slice(0, 120), result: res.data }, ...prev].slice(0, 50));
      } catch {
        results.push({ text: comment, result: null, error: "Failed" });
      }
      setBulkResults([...results]);
      setBulkProgress(Math.round(((i + 1) / lines.length) * 100));
    }
    setBulkLoading(false);
  };

  const exportCSV = (results) => {
    const rows = [["Comment","Level","Score","Toxic"]];
    results.forEach(r => {
      const lv = r.result ? getLevel(r.result.confidence, r.result.toxic) : null;
      rows.push([
        `"${r.text.replace(/"/g, '""')}"`,
        lv ? lv.label : "Error",
        r.result ? Math.round(r.result.confidence * 100) + "%" : "—",
        r.result ? (r.result.toxic ? "Yes" : "No") : "—",
      ]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "safeguard_results.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleKeyUp = e => { if (!live) return; if (e.key === " ") { const v = e.target.value.trim(); if (v) analyze(v, true); } };
  const handleKeyDown = e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); analyze(text); } };

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
  const tierData = [
    { label:"Safe",            color:"#4ade80" },
    { label:"Mildly Toxic",    color:"#facc15" },
    { label:"Toxic",           color:"#fb923c" },
    { label:"Extremely Toxic", color:"#f87171" },
  ];
  const tierCounts = tierData.map((_, t) => history.filter(h => getLevel(h.result.confidence, h.result.toxic).tier === t).length);

  const TABS = [["howitworks","How it works"], ["analyze","Analyze"], ["bulk","Bulk Upload"], ["dashboard","Dashboard"]];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.txt, fontFamily:"'Inter',system-ui,sans-serif" }}>

      {/* ── NAV ── */}
      <nav style={{ background:C.card, borderBottom:`1px solid ${C.border}`, padding:"0 32px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:20 }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:"#1e293b", border:"1px solid #334155", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="16" height="16" viewBox="0 0 22 22" fill="none">
              <path d="M11 2L3 6V12C3 16.4 6.6 20.2 11 21C15.4 20.2 19 16.4 19 12V6L11 2Z" fill="#6366f1" opacity="0.9"/>
              <path d="M8 11L10.5 13.5L14.5 9.5" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={{ fontSize:17, fontWeight:800, color:"#f0f4ff", letterSpacing:"-0.02em" }}>SafeGuard</span>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", background:C.bg, borderRadius:10, padding:3, gap:2, border:`1px solid ${C.border}` }}>
          {TABS.map(([id, lbl]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding:"7px 20px", borderRadius:8, fontSize:14, fontWeight:600, border:"none", cursor:"pointer", transition:"all 0.18s",
              background: tab === id ? "#1e293b" : "transparent",
              color: tab === id ? "#fff" : C.txt2,
              boxShadow: "none",
            }}>{lbl}</button>
          ))}
        </div>

        {/* Live toggle */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:13, fontWeight:600, color: live ? "#4ade80" : C.txt2 }}>Live</span>
          <div onClick={() => setLive(v => !v)} style={{ width:40, height:22, borderRadius:999, background: live ? "#16a34a" : C.border2, cursor:"pointer", position:"relative", transition:"background 0.2s", boxShadow: "none", border:`1px solid ${live ? "#4ade80" : C.border2}` }}>
            <span style={{ position:"absolute", top:3, left: live ? 21 : 3, width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 4px rgba(0,0,0,0.4)" }} />
          </div>
        </div>
      </nav>

      {/* ── HOW IT WORKS ── */}
      {tab === "howitworks" && (
        <div style={{ padding:"48px 40px 80px" }}>
          <div style={{ maxWidth:900, margin:"0 auto" }}>

            {/* Hero */}
            <div style={{ textAlign:"center", marginBottom:56 }}>
              <div style={{ display:"inline-block", padding:"6px 18px", borderRadius:999, background:"#0e1525", border:"1px solid #1a2540", marginBottom:20 }}>
                <span style={{ fontSize:12, fontWeight:700, color:"#a5b4fc", letterSpacing:"0.1em", textTransform:"uppercase" }}>Machine Learning Pipeline</span>
              </div>
              <h1 style={{ fontSize:48, fontWeight:900, color:"#f0f4ff", margin:"0 0 16px", letterSpacing:"-0.04em", lineHeight:1.1 }}>
                How <span style={{ color:"#818cf8" }}>SafeGuard</span> works
              </h1>
              <p style={{ fontSize:18, color:C.txt2, maxWidth:560, margin:"0 auto", lineHeight:1.7 }}>
                Real-time toxicity detection using a TF-IDF + Logistic Regression model trained on 160,000+ real-world comments.
              </p>
            </div>

            {/* Steps */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:40 }}>
              {[
                { step:"01", title:"You type a comment", desc:"In live mode, SafeGuard listens as you type. After each word (Space key), it sends the text for analysis instantly — no button click needed.", color:"#38bdf8", glow:"rgba(56,189,248,0.3)", bg:"rgba(56,189,248,0.06)", icon:<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M8 10h8 M8 14h5" stroke="#38bdf8" strokeWidth="1.8" strokeLinecap="round" fill="none"/> },
                { step:"02", title:"TF-IDF vectorises text", desc:"Your comment becomes a numerical vector. TF-IDF gives higher weight to words that are rare in normal text but common in toxic comments.", color:"#a78bfa", glow:"rgba(167,139,250,0.3)", bg:"rgba(167,139,250,0.06)", icon:<><path d="M4 6h16M4 10h12M4 14h8M4 18h4" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" fill="none"/></> },
                { step:"03", title:"Logistic Regression classifies", desc:"The vector is fed into a model trained on the Jigsaw Toxic Comment dataset. It outputs a probability score between 0 and 1.", color:"#facc15", glow:"rgba(250,204,21,0.3)", bg:"rgba(250,204,21,0.06)", icon:<><circle cx="12" cy="12" r="9" stroke="#facc15" strokeWidth="1.8" fill="none"/><path d="M8 12l3 3 5-5" stroke="#facc15" strokeWidth="1.8" strokeLinecap="round" fill="none"/></> },
                { step:"04", title:"Score maps to a level", desc:"Confidence < 30% = Safe. 30-50% = Mildly Toxic. 50-75% = Toxic. > 75% = Extremely Toxic. Harmful words are highlighted in red.", color:"#f87171", glow:"rgba(248,113,113,0.3)", bg:"rgba(248,113,113,0.06)", icon:<path d="M12 2L3 6v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V6l-9-4z" stroke="#f87171" strokeWidth="1.8" fill="none"/> },
              ].map(({ step, title, desc, color, glow, bg, icon }) => (
                <div key={step} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:28, position:"relative", overflow:"hidden", transition:"border-color 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = color + "60"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                >
                  <div style={{ display:"flex", alignItems:"flex-start", gap:16, marginBottom:14 }}>
                    <div style={{ width:44, height:44, borderRadius:12, background:bg, border:`1px solid ${color}40`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <svg width="20" height="20" viewBox="0 0 24 24">{icon}</svg>
                    </div>
                    <div>
                      <div style={{ fontSize:11, fontWeight:800, color, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:4 }}>{step}</div>
                      <div style={{ fontSize:17, fontWeight:700, color:"#f0f4ff", lineHeight:1.3 }}>{title}</div>
                    </div>
                  </div>
                  <p style={{ fontSize:14, color:C.txt2, lineHeight:1.75, margin:0 }}>{desc}</p>
                </div>
              ))}
            </div>

            {/* Model stats strip */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"0", overflow:"hidden", marginBottom:24 }}>
              <div style={{ padding:"14px 24px", borderBottom:`1px solid ${C.border}`, background:"transparent" }}>
                <span style={{ fontSize:12, fontWeight:700, color:"#818cf8", letterSpacing:"0.1em", textTransform:"uppercase" }}>Model Details</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)" }}>
                {[
                  { label:"Algorithm",     value:"Logistic Regression", color:"#a78bfa" },
                  { label:"Vectorizer",    value:"TF-IDF",              color:"#38bdf8" },
                  { label:"Training data", value:"160k+ comments",      color:"#4ade80" },
                  { label:"Dataset",       value:"Jigsaw / Kaggle",     color:"#facc15" },
                  { label:"Accuracy",      value:"~96%",                color:"#fb923c" },
                  { label:"Backend",       value:"FastAPI + sklearn",   color:"#f472b6" },
                ].map(({ label, value, color }, i) => (
                  <div key={label} style={{ padding:"18px 24px", borderRight: i % 3 !== 2 ? `1px solid ${C.border}` : "none", borderBottom: i < 3 ? `1px solid ${C.border}` : "none" }}>
                    <div style={{ fontSize:11, color:C.txt3, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>{label}</div>
                    <div style={{ fontSize:17, fontWeight:700, color }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Toxicity levels */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, overflow:"hidden", marginBottom:24 }}>
              <div style={{ padding:"14px 24px", borderBottom:`1px solid ${C.border}`, background:"transparent" }}>
                <span style={{ fontSize:12, fontWeight:700, color:"#818cf8", letterSpacing:"0.1em", textTransform:"uppercase" }}>Toxicity Levels</span>
              </div>
              {[
                { label:"Safe",            range:"0 – 30%",   color:"#4ade80", desc:"No harmful language detected. Safe to publish." },
                { label:"Mildly Toxic",    range:"30 – 50%",  color:"#facc15", desc:"Low-level negativity. Worth monitoring but may not need action." },
                { label:"Toxic",           range:"50 – 75%",  color:"#fb923c", desc:"Harmful or offensive language detected. Flag for human review." },
                { label:"Extremely Toxic", range:"75 – 100%", color:"#f87171", desc:"Highly toxic. Recommend immediate removal." },
              ].map(({ label, range, color, desc }, i) => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:20, padding:"16px 24px", borderBottom: i < 3 ? `1px solid ${C.border}` : "none", transition:"background 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{ width:10, height:10, borderRadius:"50%", background:color, flexShrink:0, boxShadow:`0 0 8px ${color}80` }} />
                  <div style={{ width:140, flexShrink:0 }}>
                    <div style={{ fontSize:15, fontWeight:700, color }}>{label}</div>
                    <div style={{ fontSize:12, color:C.txt3, marginTop:2 }}>{range}</div>
                  </div>
                  <p style={{ fontSize:14, color:C.txt2, margin:0, lineHeight:1.65 }}>{desc}</p>
                </div>
              ))}
            </div>

            {/* Limitations */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, overflow:"hidden" }}>
              <div style={{ padding:"14px 24px", borderBottom:`1px solid ${C.border}`, background:"transparent" }}>
                <span style={{ fontSize:12, fontWeight:700, color:"#facc15", letterSpacing:"0.1em", textTransform:"uppercase" }}>Limitations</span>
              </div>
              <div style={{ padding:"20px 24px", display:"flex", flexDirection:"column", gap:14 }}>
                {[
                  "The model is probabilistic — a high score does not guarantee a comment is toxic, just that it resembles toxic patterns in training data.",
                  "Sarcasm, irony, and context-dependent language can confuse the model. Tone-based toxicity may not trigger keyword highlights.",
                  "The keyword highlighter uses regex pattern matching, not the ML model — highlighted words may not be the actual cause of the score.",
                  "The model was trained on English comments. Performance on other languages is not reliable.",
                ].map((t, i) => (
                  <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                    <span style={{ fontSize:16, color:"#facc15", flexShrink:0, marginTop:1 }}>⚠</span>
                    <p style={{ fontSize:14, color:C.txt2, margin:0, lineHeight:1.75 }}>{t}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ANALYZE ── */}
      {tab === "analyze" && (
        <div style={{ padding:"40px 40px 80px" }}>
          <div style={{ maxWidth:1100, margin:"0 auto" }}>
            <div style={{ marginBottom:28 }}>
              <h1 style={{ fontSize:32, fontWeight:900, color:"#f0f4ff", margin:"0 0 8px", letterSpacing:"-0.03em" }}>Comment Analyzer</h1>
              <p style={{ fontSize:15, color:C.txt2, margin:0 }}>{live ? "Updates after each word as you type." : "Press Ctrl+Enter to analyze."}</p>
            </div>

            <div style={{ display:"grid", gridTemplateColumns: result ? "1fr 1fr" : "1fr", gap:16, alignItems:"start" }}>

              {/* Input */}
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, overflow:"hidden" }}>
                <div style={{ padding:"12px 20px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", background:"transparent" }}>
                  <span style={{ fontSize:12, fontWeight:700, color:"#818cf8", letterSpacing:"0.1em", textTransform:"uppercase" }}>Input</span>
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    {loading && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ animation:"spin 0.8s linear infinite" }}><circle cx="12" cy="12" r="9" stroke="#1e293b" strokeWidth="2.5"/><path d="M12 3a9 9 0 0 1 9 9" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round"/></svg>}
                    <span style={{ fontSize:12, fontWeight:600, color: loading ? "#818cf8" : live ? "#4ade80" : C.txt2 }}>{loading ? "Analyzing…" : live ? "Live" : "Manual"}</span>
                  </div>
                </div>
                <textarea ref={textareaRef} rows={9} value={text} onChange={e => setText(e.target.value)} onKeyUp={handleKeyUp} onKeyDown={handleKeyDown} placeholder="Type a comment…"
                  style={{ width:"100%", boxSizing:"border-box", display:"block", background:"transparent", border:"none", borderBottom:`1px solid ${C.border}`, padding:"16px 20px", fontSize:16, color:C.txt, lineHeight:1.75, resize:"none", outline:"none", fontFamily:"inherit" }}
                />
                <div style={{ padding:"12px 20px", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", borderBottom: text ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ fontSize:12, color:C.txt3, marginRight:4 }}>Try:</span>
                  {SAMPLES.map(([lbl, sample]) => (
                    <button key={lbl} onClick={() => { setText(sample); if (live) analyze(sample, true); }}
                      style={{ padding:"4px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:"transparent", border:`1px solid ${C.border2}`, color:C.txt2, cursor:"pointer", transition:"all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor="#6366f1"; e.currentTarget.style.color="#a5b4fc"; e.currentTarget.style.background="rgba(99,102,241,0.1)"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor=C.border2; e.currentTarget.style.color=C.txt2; e.currentTarget.style.background="transparent"; }}
                    >{lbl}</button>
                  ))}
                  {text && <button onClick={() => { setText(""); setResult(null); textareaRef.current?.focus(); }} style={{ marginLeft:"auto", padding:"4px 12px", borderRadius:8, fontSize:12, background:"transparent", border:`1px solid ${C.border2}`, color:C.txt3, cursor:"pointer" }}>Clear</button>}
                </div>
                {!live && text && (
                  <div style={{ padding:"14px 16px" }}>
                    <button onClick={() => analyze(text)} disabled={!text.trim() || loading} style={{ width:"100%", padding:11, borderRadius:10, fontSize:15, fontWeight:700, border:"none", cursor: !text.trim() || loading ? "not-allowed" : "pointer", background: !text.trim() || loading ? C.border : "#4f46e5", color: !text.trim() || loading ? C.txt3 : "#fff", transition:"all 0.18s" }}>
                      Analyze <span style={{ opacity:0.5, fontWeight:400, fontSize:12 }}>Ctrl+Enter</span>
                    </button>
                  </div>
                )}
                {error && <div style={{ margin:"0 16px 14px", padding:"10px 14px", borderRadius:10, background:"rgba(248,113,113,0.1)", border:"1px solid rgba(248,113,113,0.3)", color:"#fca5a5", fontSize:13 }}>{error}</div>}
              </div>

              {/* Result */}
              {result && level && (
                <div style={{ background:C.card, border:`1px solid ${level.color}40`, borderRadius:16, overflow:"hidden", animation:"fadeUp 0.3s ease both", boxShadow:"none" }}>
                  <div style={{ padding:"12px 20px", borderBottom:`1px solid ${level.color}30`, background:`${level.color}10`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ width:9, height:9, borderRadius:"50%", background:level.color,  }} />
                      <span style={{ fontSize:15, fontWeight:800, color:level.color }}>{level.label}</span>
                    </div>
                    <span style={{ fontSize:12, fontWeight:600, color:level.color, opacity:0.7 }}>
                      {["No action","Monitor","Flag","Remove"][level.tier]}
                    </span>
                  </div>
                  <div style={{ padding:20 }}>
                    <Meter score={result.confidence} color={level.color} glow={level.glow} />
                    {parts && (
                      <div style={{ margin:"16px 0" }}>
                        <p style={{ fontSize:12, color:"#818cf8", fontWeight:700, margin:"0 0 8px", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                          {hasToxicWords ? "Flagged Words" : "Comment"}
                        </p>
                        <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 16px", fontSize:15, lineHeight:1.85, color:C.txt2 }}>
                          {parts.map((part, i) =>
                            part.toxic
                              ? <span key={i} style={{ background:"rgba(248,113,113,0.15)", color:"#fca5a5", borderRadius:5, padding:"2px 6px", border:"1px solid rgba(248,113,113,0.35)", fontWeight:700 }}>{part.text}</span>
                              : <span key={i}>{part.text}</span>
                          )}
                        </div>
                        {!hasToxicWords && result.toxic && <p style={{ fontSize:12, color:C.txt3, margin:"6px 0 0" }}>Tone-based detection — no exact keyword matched.</p>}
                      </div>
                    )}
                    <p style={{ fontSize:14, color:C.txt2, lineHeight:1.7, margin:0 }}>{VERDICTS[level.tier]}</p>
                  </div>
                </div>
              )}
            </div>

            {history.length > 0 && (
              <div style={{ marginTop:32 }}>
                <p style={{ fontSize:12, color:"#818cf8", fontWeight:700, margin:"0 0 12px", textTransform:"uppercase", letterSpacing:"0.08em" }}>Recent ({history.length})</p>
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  {history.slice(0, 5).map((h, i) => {
                    const lv = getLevel(h.result.confidence, h.result.toxic);
                    return (
                      <button key={i} onClick={() => { setText(h.text); setResult(h.result); }}
                        style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 16px", borderRadius:10, background:C.card, border:`1px solid ${C.border}`, cursor:"pointer", textAlign:"left", width:"100%", transition:"border-color 0.15s" }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = lv.color + "60"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                      >
                        <span style={{ width:7, height:7, borderRadius:"50%", background:lv.color, flexShrink:0,  }} />
                        <span style={{ flex:1, fontSize:13, color:C.txt2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.text}</span>
                        <span style={{ fontSize:13, fontWeight:700, color:lv.color, flexShrink:0 }}>{lv.label}</span>
                        <span style={{ fontSize:12, color:C.txt3, flexShrink:0 }}>{Math.round(h.result.confidence * 100)}%</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {tab === "dashboard" && (
        <div style={{ padding:"40px 40px 80px" }}>
          <div style={{ maxWidth:900, margin:"0 auto" }}>
            <h1 style={{ fontSize:32, fontWeight:900, color:"#f0f4ff", margin:"0 0 8px", letterSpacing:"-0.03em" }}>Dashboard</h1>
            <p style={{ fontSize:15, color:C.txt2, margin:"0 0 32px" }}>{total === 0 ? "No comments analyzed yet." : `${total} comment${total !== 1 ? "s" : ""} analyzed this session.`}</p>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
              {[
                { label:"Total",     value:total,              color:"#818cf8" },
                { label:"Toxic",     value:toxicCount,         color:"#f87171" },
                { label:"Safe",      value:total - toxicCount, color:"#4ade80" },
                { label:"Avg Score", value:`${avgScore}%`,     color:"#facc15" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"20px 22px", position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", top:-20, right:-20, width:80, height:80, borderRadius:"50%", background:"transparent" }} />
                  <p style={{ fontSize:11, color:C.txt3, margin:"0 0 10px", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>{label}</p>
                  <p style={{ fontSize:34, fontWeight:900, color, margin:0, letterSpacing:"-0.04em",  }}>{value}</p>
                </div>
              ))}
            </div>

            {total > 0 && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"20px 24px", marginBottom:14 }}>
                <p style={{ fontSize:12, color:"#818cf8", fontWeight:700, margin:"0 0 18px", textTransform:"uppercase", letterSpacing:"0.08em" }}>Level Breakdown</p>
                {tierData.map(({ label, color }, tier) => (
                  <div key={tier} style={{ display:"flex", alignItems:"center", gap:14, marginBottom:12 }}>
                    <span style={{ fontSize:13, color:C.txt2, width:130, flexShrink:0 }}>{label}</span>
                    <div style={{ flex:1, height:8, background:C.bg, borderRadius:999, overflow:"hidden" }}>
                      <div style={{ height:"100%", background:color, borderRadius:999, width:`${total ? (tierCounts[tier] / total) * 100 : 0}%`, transition:"width 0.7s cubic-bezier(0.16,1,0.3,1)",  }} />
                    </div>
                    <span style={{ fontSize:14, fontWeight:700, color, width:24, textAlign:"right", flexShrink:0 }}>{tierCounts[tier]}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"20px 24px", marginBottom:14 }}>
              <p style={{ fontSize:12, color:"#818cf8", fontWeight:700, margin:"0 0 16px", textTransform:"uppercase", letterSpacing:"0.08em" }}>Most Flagged Terms</p>
              {topWords.length === 0
                ? <p style={{ fontSize:14, color:C.txt3, margin:0 }}>No toxic terms logged yet.</p>
                : <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {topWords.map(([word, count]) => (
                      <div key={word} style={{ display:"flex", alignItems:"center", gap:12 }}>
                        <code style={{ fontSize:13, color:"#f87171", width:110, textAlign:"right", flexShrink:0 }}>{word}</code>
                        <div style={{ flex:1, height:6, background:C.bg, borderRadius:999, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${(count / topWords[0][1]) * 100}%`, background:"#ef4444", borderRadius:999, transition:"width 0.6s" }} />
                        </div>
                        <span style={{ fontSize:12, color:C.txt3, width:24, flexShrink:0 }}>{count}x</span>
                      </div>
                    ))}
                  </div>
              }
            </div>

            {history.length > 0 && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"20px 24px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                  <p style={{ fontSize:12, color:"#818cf8", fontWeight:700, margin:0, textTransform:"uppercase", letterSpacing:"0.08em" }}>Comment Log</p>
                  <button onClick={() => { setHistory([]); setResult(null); }} style={{ fontSize:12, color:C.txt3, background:"none", border:"none", cursor:"pointer" }}
                    onMouseEnter={e => e.currentTarget.style.color="#f87171"}
                    onMouseLeave={e => e.currentTarget.style.color=C.txt3}
                  >Clear all</button>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:300, overflowY:"auto" }}>
                  {history.map((h, i) => {
                    const lv = getLevel(h.result.confidence, h.result.toxic);
                    return (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:8, background:C.bg }}>
                        <span style={{ width:6, height:6, borderRadius:"50%", background:lv.color, flexShrink:0,  }} />
                        <span style={{ flex:1, fontSize:13, color:C.txt2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.text}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:lv.color, flexShrink:0 }}>{lv.label}</span>
                        <span style={{ fontSize:12, color:C.txt3, flexShrink:0 }}>{Math.round(h.result.confidence * 100)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}


      {/* ── BULK UPLOAD ── */}
      {tab === "bulk" && (
        <div style={{ padding:"40px 40px 80px" }}>
          <div style={{ maxWidth:900, margin:"0 auto" }}>
            <h1 style={{ fontSize:32, fontWeight:900, color:"#f0f4ff", margin:"0 0 8px", letterSpacing:"-0.03em" }}>Bulk Upload</h1>
            <p style={{ fontSize:15, color:C.txt2, margin:"0 0 32px" }}>
              Upload a <code style={{ background:C.card, padding:"2px 7px", borderRadius:5, color:"#818cf8", fontSize:14 }}>.txt</code> or <code style={{ background:C.card, padding:"2px 7px", borderRadius:5, color:"#818cf8", fontSize:14 }}>.csv</code> file — one comment per line. Each comment is analyzed and results are shown below.
            </p>

            {/* Drop zone */}
            <label htmlFor="bulk-file" style={{ display:"block", marginBottom:20, cursor:"pointer" }}>
              <div style={{ border:`2px dashed ${C.border2}`, borderRadius:16, padding:"40px 32px", textAlign:"center", background:C.card, transition:"border-color 0.2s" }}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor="#4f46e5"; }}
                onDragLeave={e => { e.currentTarget.style.borderColor=C.border2; }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor=C.border2;
                  const file = e.dataTransfer.files[0];
                  if (file) handleBulkFile(file);
                }}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ margin:"0 auto 14px", display:"block" }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round"/>
                  <polyline points="17 8 12 3 7 8" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="12" y1="3" x2="12" y2="15" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
                <p style={{ fontSize:16, fontWeight:600, color:C.txt, margin:"0 0 6px" }}>Drop your file here</p>
                <p style={{ fontSize:13, color:C.txt2, margin:"0 0 16px" }}>or click to browse</p>
                <span style={{ display:"inline-block", padding:"8px 20px", borderRadius:8, background:"#4f46e5", color:"#fff", fontSize:13, fontWeight:600 }}>Choose File</span>
              </div>
            </label>
            <input id="bulk-file" type="file" accept=".txt,.csv" style={{ display:"none" }} onChange={e => { if (e.target.files[0]) handleBulkFile(e.target.files[0]); e.target.value=""; }} />

            {/* Progress */}
            {bulkLoading && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px 24px", marginBottom:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <span style={{ fontSize:13, fontWeight:600, color:C.txt2 }}>Analyzing comments…</span>
                  <span style={{ fontSize:13, fontWeight:700, color:"#818cf8" }}>{bulkProgress}%</span>
                </div>
                <div style={{ height:6, background:C.bg, borderRadius:999, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${bulkProgress}%`, background:"#4f46e5", borderRadius:999, transition:"width 0.3s" }} />
                </div>
              </div>
            )}

            {/* Summary */}
            {bulkResults.length > 0 && !bulkLoading && (() => {
              const toxicB = bulkResults.filter(r => r.result?.toxic).length;
              const safeB = bulkResults.length - toxicB;
              const avgB = Math.round(bulkResults.filter(r => r.result).reduce((s, r) => s + r.result.confidence, 0) / bulkResults.filter(r => r.result).length * 100);
              return (
                <div style={{ marginBottom:16 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:14 }}>
                    {[
                      { label:"Total",     value:bulkResults.length, color:"#818cf8" },
                      { label:"Toxic",     value:toxicB,             color:"#f87171" },
                      { label:"Safe",      value:safeB,              color:"#4ade80" },
                      { label:"Avg Score", value:`${avgB}%`,         color:"#facc15" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 18px" }}>
                        <p style={{ fontSize:11, color:C.txt3, margin:"0 0 8px", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>{label}</p>
                        <p style={{ fontSize:28, fontWeight:900, color, margin:0, letterSpacing:"-0.03em" }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Export button */}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                    <p style={{ fontSize:12, color:"#818cf8", fontWeight:700, margin:0, textTransform:"uppercase", letterSpacing:"0.08em" }}>Results ({bulkResults.length})</p>
                    <button onClick={() => exportCSV(bulkResults)} style={{ padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:600, background:"#1e293b", border:`1px solid ${C.border2}`, color:C.txt2, cursor:"pointer", transition:"all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor="#4f46e5"; e.currentTarget.style.color="#a5b4fc"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor=C.border2; e.currentTarget.style.color=C.txt2; }}
                    >Export CSV</button>
                  </div>
                </div>
              );
            })()}

            {/* Results table */}
            {bulkResults.length > 0 && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, overflow:"hidden" }}>
                {/* Table header */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 130px 80px", padding:"10px 20px", borderBottom:`1px solid ${C.border}`, background:C.bg }}>
                  <span style={{ fontSize:11, color:C.txt3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" }}>Comment</span>
                  <span style={{ fontSize:11, color:C.txt3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" }}>Level</span>
                  <span style={{ fontSize:11, color:C.txt3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", textAlign:"right" }}>Score</span>
                </div>
                <div style={{ maxHeight:480, overflowY:"auto" }}>
                  {bulkResults.map((row, i) => {
                    const lv = row.result ? getLevel(row.result.confidence, row.result.toxic) : null;
                    return (
                      <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 130px 80px", padding:"12px 20px", borderBottom: i < bulkResults.length - 1 ? `1px solid ${C.border}` : "none", alignItems:"center", transition:"background 0.15s" }}
                        onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.02)"}
                        onMouseLeave={e => e.currentTarget.style.background="transparent"}
                      >
                        <span style={{ fontSize:13, color: row.error ? "#f87171" : C.txt2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", paddingRight:16 }}>
                          {row.error ? `Error: ${row.error}` : row.text}
                        </span>
                        {lv ? (
                          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                            <span style={{ width:6, height:6, borderRadius:"50%", background:lv.color, flexShrink:0 }} />
                            <span style={{ fontSize:12, fontWeight:600, color:lv.color }}>{lv.label}</span>
                          </div>
                        ) : <span style={{ fontSize:12, color:C.txt3 }}>—</span>}
                        <span style={{ fontSize:13, fontWeight:700, color: lv ? lv.color : C.txt3, textAlign:"right" }}>
                          {row.result ? `${Math.round(row.result.confidence * 100)}%` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {bulkResults.length === 0 && !bulkLoading && (
              <div style={{ textAlign:"center", padding:"48px 24px", background:C.card, border:`1px solid ${C.border}`, borderRadius:14, color:C.txt3 }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ margin:"0 auto 12px", display:"block", opacity:0.4 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={C.txt3} strokeWidth="1.5"/>
                  <polyline points="14 2 14 8 20 8" stroke={C.txt3} strokeWidth="1.5"/>
                  <line x1="8" y1="13" x2="16" y2="13" stroke={C.txt3} strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="8" y1="17" x2="12" y2="17" stroke={C.txt3} strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <p style={{ fontSize:15, margin:"0 0 6px", fontWeight:600, color:C.txt2 }}>No file uploaded yet</p>
                <p style={{ fontSize:13, margin:0 }}>Upload a .txt or .csv file with one comment per line</p>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        * { box-sizing: border-box; }
        body { margin: 0; background: #080d1a; }
        textarea { caret-color: #818cf8; }
        textarea::placeholder { color: #1a2540; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #1a2540; border-radius: 2px; }
      `}</style>
    </div>
  );
}