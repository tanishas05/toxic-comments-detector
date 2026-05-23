import { useState, useEffect, useRef } from "react";
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
  TOXIC_PATTERNS.forEach((pattern) => {
    const re = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      indices.push({ start: m.index, end: m.index + m[0].length });
    }
  });
  indices.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const seg of indices) {
    if (merged.length && seg.start < merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, seg.end);
    } else merged.push({ ...seg });
  }
  const parts = [];
  let cursor = 0;
  for (const seg of merged) {
    if (cursor < seg.start) parts.push({ text: text.slice(cursor, seg.start), highlight: false });
    parts.push({ text: text.slice(seg.start, seg.end), highlight: true });
    cursor = seg.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlight: false });
  return parts;
}

function getToxicityLevel(confidence, isToxic) {
  if (!isToxic || confidence < 0.3)
    return { label: "Safe",           tier: 0, color: "#34d399", dimColor: "#065f46", trackColor: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.18)"  };
  if (confidence < 0.5)
    return { label: "Mildly Toxic",   tier: 1, color: "#fbbf24", dimColor: "#78350f", trackColor: "rgba(251,191,36,0.10)",  border: "rgba(251,191,36,0.2)"   };
  if (confidence < 0.75)
    return { label: "Toxic",          tier: 2, color: "#fb923c", dimColor: "#7c2d12", trackColor: "rgba(251,146,60,0.10)",  border: "rgba(251,146,60,0.2)"   };
  return   { label: "Extremely Toxic",tier: 3, color: "#f87171", dimColor: "#7f1d1d", trackColor: "rgba(248,113,113,0.10)", border: "rgba(248,113,113,0.2)"  };
}

function MeterBar({ score, color }) {
  const pct = Math.round(score * 100);
  const filled = Math.round((pct / 100) * 20);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
        <span style={{ fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#3d4a5c", fontWeight: 700 }}>
          Toxicity Score
        </span>
        <span style={{ fontSize: "36px", fontWeight: 800, color, letterSpacing: "-0.04em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {pct}<span style={{ fontSize: "18px", opacity: 0.6 }}>%</span>
        </span>
      </div>
      <div style={{ display: "flex", gap: "3px" }}>
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: "9px", borderRadius: "2px",
            background: i < filled ? color : "rgba(255,255,255,0.05)",
            transition: `background 0.04s ${i * 30}ms ease`,
          }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#1e2d3d", marginTop: "5px", letterSpacing: "0.05em" }}>
        <span>SAFE</span><span>MILD</span><span>TOXIC</span><span>EXTREME</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
      borderRadius: "14px", padding: "18px 20px",
    }}>
      <div style={{ fontSize: "10px", color: "#2d3a47", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: "10px" }}>{label}</div>
      <div style={{ fontSize: "26px", fontWeight: 800, color, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function TopWordsBar({ words }) {
  if (!words.length) return <p style={{ color: "#1e2d3d", fontSize: "14px", margin: 0 }}>No toxic terms logged yet.</p>;
  const max = words[0][1];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {words.map(([word, count]) => (
        <div key={word} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <code style={{ fontSize: "12px", color: "#8b9eb0", width: "100px", textAlign: "right", flexShrink: 0 }}>{word}</code>
          <div style={{ flex: 1, height: "5px", background: "rgba(255,255,255,0.04)", borderRadius: "999px", overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${(count / max) * 100}%`,
              background: "linear-gradient(90deg, #fb923c, #f87171)",
              borderRadius: "999px", transition: "width 0.7s cubic-bezier(0.16,1,0.3,1)",
            }} />
          </div>
          <span style={{ fontSize: "11px", color: "#2d3a47", width: "20px" }}>{count}x</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("analyze");
  const [history, setHistory] = useState([]);
  const [liveMode, setLiveMode] = useState(true);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);

  const runAnalysis = async (input, silent = false) => {
    if (!input.trim()) { setResult(null); return; }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const res = await axios.post(
        "http://127.0.0.1:8000/predict",
        { text: input },
        { signal: controller.signal }
      );
      setResult(res.data);
      setHistory((prev) => {
        const entry = { text: input.slice(0, 120), result: res.data };
        return [entry, ...prev.filter((h) => h.text !== entry.text)].slice(0, 50);
      });
    } catch (err) {
      if (axios.isCancel(err) || err.name === "CanceledError") return;
      if (!silent) setError("Cannot reach the backend — make sure FastAPI is running on port 8000.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleTextChange = (e) => {
    const val = e.target.value;
    setText(val);
    if (!val.trim()) { setResult(null); return; }
    if (liveMode && val.endsWith(" ")) {
      runAnalysis(val.trim(), true);
    }
  };

  const handleManualAnalyze = () => { runAnalysis(text); };

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleManualAnalyze();
  };

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const level = result ? getToxicityLevel(result.confidence, result.toxic) : null;
  const highlighted = result ? getHighlightedParts(text) : null;
  const hasFlags = highlighted?.some((p) => p.highlight);

  const totalAnalyzed = history.length;
  const toxicCount = history.filter((h) => h.result.toxic).length;
  const toxicPct = totalAnalyzed ? Math.round((toxicCount / totalAnalyzed) * 100) : 0;
  const avgScore = totalAnalyzed
    ? Math.round((history.reduce((s, h) => s + h.result.confidence, 0) / totalAnalyzed) * 100)
    : 0;

  const wordFreq = {};
  history.filter((h) => h.result.toxic).forEach((h) => {
    TOXIC_PATTERNS.forEach((p) => {
      const re = new RegExp(p.source, p.flags);
      let m;
      while ((m = re.exec(h.text)) !== null) {
        const w = m[0].toLowerCase();
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    });
  });
  const topWords = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const Tab = ({ id, label }) => (
    <button onClick={() => setActiveTab(id)} style={{
      padding: "7px 16px", fontSize: "13px", fontWeight: 600,
      border: "none", cursor: "pointer", borderRadius: "8px",
      background: activeTab === id ? "rgba(255,255,255,0.07)" : "transparent",
      color: activeTab === id ? "#cdd9e5" : "#3d4a5c",
      transition: "all 0.18s",
    }}>{label}</button>
  );

  const InputCard = () => (
    <div style={{
      background: "rgba(10,14,26,0.95)", border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: "18px", padding: "22px", backdropFilter: "blur(10px)",
    }}>
      { }
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
        <span style={{ fontSize: "11px", color: "#2d3a47", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>
          Comment Input
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {loading && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 0.75s linear infinite", flexShrink: 0 }}>
              <circle cx="12" cy="12" r="9" stroke="rgba(99,130,175,0.25)" strokeWidth="2.5"/>
              <path d="M12 3a9 9 0 0 1 9 9" stroke="#6382af" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          )}
          <span style={{ fontSize: "11px", color: loading ? "#6382af" : "#1e2d3d" }}>
            {loading ? "Analyzing" : liveMode ? "Live" : "Manual"}
          </span>
          { }
          <button onClick={() => setLiveMode((v) => !v)} style={{
            width: "34px", height: "18px", borderRadius: "999px", border: "none", cursor: "pointer",
            background: liveMode ? "#6382af" : "rgba(255,255,255,0.08)", position: "relative", transition: "background 0.22s",
          }}>
            <span style={{
              position: "absolute", top: "2px", left: liveMode ? "18px" : "2px",
              width: "14px", height: "14px", borderRadius: "50%", background: "#fff",
              transition: "left 0.22s",
            }}/>
          </button>
        </div>
      </div>

      <textarea
        rows={7}
        value={text}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        placeholder="Type or paste a comment..."
        style={{
          width: "100%", boxSizing: "border-box",
          background: "rgba(5,8,18,0.9)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "12px", padding: "14px 16px",
          fontSize: "14px", color: "#a8b9cc", lineHeight: 1.75,
          resize: "vertical", outline: "none", fontFamily: "inherit",
          transition: "border-color 0.18s",
        }}
        onFocus={(e) => (e.target.style.borderColor = "rgba(99,130,175,0.35)")}
        onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.06)")}
      />

      { }
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
        {[
          ["Safe",    "Thanks for sharing this! Really appreciate the effort."],
          ["Mild",    "This is getting a bit annoying honestly."],
          ["Toxic",   "You're such an idiot, nobody cares about your stupid opinion."],
          ["Extreme", "I hate you, worthless garbage, shut up and go die."],
        ].map(([label, sample]) => (
          <button key={label} onClick={() => { setText(sample); setResult(null); if (liveMode) { runAnalysis(sample, true); } }} style={{
            padding: "5px 12px", borderRadius: "7px", fontSize: "12px", fontWeight: 600,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
            color: "#2d3a47", cursor: "pointer", transition: "all 0.15s",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(99,130,175,0.1)"; e.currentTarget.style.color = "#7a99bd"; e.currentTarget.style.borderColor = "rgba(99,130,175,0.2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = "#2d3a47"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
          >{label}</button>
        ))}
      </div>

      {!liveMode && (
        <button onClick={handleManualAnalyze} disabled={loading || !text.trim()} style={{
          marginTop: "12px", width: "100%", padding: "12px",
          borderRadius: "11px", fontSize: "14px", fontWeight: 700,
          border: "none", cursor: !text.trim() || loading ? "not-allowed" : "pointer",
          background: !text.trim() || loading ? "rgba(99,130,175,0.12)" : "rgba(99,130,175,0.22)",
          color: !text.trim() || loading ? "#1e2d3d" : "#a8c0dc",
          transition: "all 0.18s",
        }}
          onMouseEnter={(e) => { if (text.trim() && !loading) e.currentTarget.style.background = "rgba(99,130,175,0.3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = !text.trim() || loading ? "rgba(99,130,175,0.12)" : "rgba(99,130,175,0.22)"; }}
          onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.985)"; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        >Analyze  <span style={{ opacity: 0.4, fontWeight: 400 }}>Ctrl+Enter</span></button>
      )}

      {error && (
        <div style={{
          marginTop: "10px", padding: "11px 14px", borderRadius: "10px",
          background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.15)",
          color: "#f87171", fontSize: "13px", lineHeight: 1.5,
        }}>{error}</div>
      )}
    </div>
  );
 
  const ResultCard = () => {
    if (!result || !level) return null;
    return (
      <div style={{
        background: "rgba(10,14,26,0.95)", border: `1px solid ${level.border}`,
        borderRadius: "18px", padding: "22px", backdropFilter: "blur(10px)",
        animation: "fadeUp 0.35s ease both",
      }}>
        { }
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "7px",
          padding: "5px 13px", borderRadius: "999px",
          background: level.trackColor, border: `1px solid ${level.border}`,
          marginBottom: "18px",
        }}>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: level.color }} />
          <span style={{ fontSize: "12px", fontWeight: 700, color: level.color, letterSpacing: "0.05em" }}>{level.label}</span>
        </div>

        <MeterBar score={result.confidence} color={level.color} />

        { }
        {hasFlags && (
          <div style={{ marginTop: "18px" }}>
            <div style={{ fontSize: "10px", color: "#1e2d3d", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: "8px" }}>
              Flagged Terms
            </div>
            <div style={{
              padding: "13px 15px", borderRadius: "11px",
              background: "rgba(5,8,18,0.9)", border: "1px solid rgba(255,255,255,0.05)",
              fontSize: "14px", color: "#7a8fa0", lineHeight: 1.8,
            }}>
              {highlighted.map((part, i) =>
                part.highlight ? (
                  <mark key={i} style={{
                    background: "rgba(248,113,113,0.15)", color: "#fca5a5",
                    borderRadius: "4px", padding: "1px 5px",
                    border: "1px solid rgba(248,113,113,0.25)",
                  }}>{part.text}</mark>
                ) : <span key={i}>{part.text}</span>
              )}
            </div>
          </div>
        )}

        {}
        <div style={{
          marginTop: "14px", padding: "13px 15px", borderRadius: "11px",
          background: level.trackColor, border: `1px solid ${level.border}`,
        }}>
          <p style={{ margin: 0, fontSize: "13px", color: "#7a8fa0", lineHeight: 1.7 }}>
            {level.tier === 0 && "This comment is safe. No harmful language detected."}
            {level.tier === 1 && "Minor indicators of negativity detected. May not require action."}
            {level.tier === 2 && "Likely contains harmful or offensive language. Flag for review."}
            {level.tier === 3 && "Highly toxic content. Recommend immediate removal."}
          </p>
        </div>

        { }
        <div style={{ display: "flex", gap: "7px", marginTop: "12px", flexWrap: "wrap" }}>
          {(level.tier === 0 ? ["Approve"] : level.tier === 1 ? ["Review", "Approve"] : level.tier === 2 ? ["Remove", "Flag"] : ["Remove", "Ban User"])
            .map((action) => (
              <button key={action} style={{
                padding: "6px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer",
                background: "rgba(255,255,255,0.03)", color: "#2d3a47",
                transition: "all 0.15s",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(99,130,175,0.1)"; e.currentTarget.style.color = "#7a99bd"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = "#2d3a47"; }}
              >{action}</button>
            ))}
        </div>
      </div>
    );
  };
  
  return (
    <div style={{ minHeight: "100vh", background: "#070b16", color: "#cdd9e5", fontFamily: "'Sora', 'Segoe UI', system-ui, sans-serif" }}>

      {/* Radial gradient header atmosphere */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(ellipse 70% 40% at 50% 0%, rgba(30,50,90,0.4), transparent)",
      }}/>

      { }
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(7,11,22,0.9)", backdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: "56px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="7" fill="rgba(99,130,175,0.15)"/>
            <path d="M12 4L5 8V13C5 17 8.2 20.7 12 22C15.8 20.7 19 17 19 13V8L12 4Z" stroke="#6382af" strokeWidth="1.4" fill="none"/>
            <path d="M9 12L11.5 14.5L15.5 10.5" stroke="#34d399" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 800, color: "#cdd9e5", letterSpacing: "-0.02em" }}>SafeGuard</span>
          <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "999px", background: "rgba(99,130,175,0.12)", color: "#6382af", fontWeight: 700, letterSpacing: "0.06em" }}>BETA</span>
        </div>
        <div style={{ display: "flex", gap: "2px" }}>
          <Tab id="analyze" label="Analyze" />
          <Tab id="dashboard" label="Dashboard" />
        </div>
        <div style={{ width: "120px" }}/> { }
      </nav>

      { }
      {activeTab === "analyze" && (
        <div style={{ maxWidth: "820px", margin: "0 auto", padding: "40px 20px 80px", position: "relative", zIndex: 1 }}>
          <div style={{ marginBottom: "36px" }}>
            <h1 style={{ fontSize: "clamp(1.9rem, 4.5vw, 2.8rem)", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.1, margin: "0 0 12px", color: "#e2ecf5" }}>
              Content Moderation
            </h1>
            <p style={{ color: "#2d3a47", fontSize: "14px", lineHeight: 1.7, maxWidth: "440px", margin: 0 }}>
              TF-IDF + Logistic Regression model trained on 160k+ Jigsaw comments.
              {liveMode ? " Analyzing as you type." : " Hit Ctrl+Enter to analyze."}
            </p>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: result ? "1fr 1fr" : "1fr",
            gap: "16px", alignItems: "start",
          }}>
            <InputCard />
            {result && <ResultCard />}
          </div>

          { }
          {history.length > 0 && (
            <div style={{ marginTop: "28px" }}>
              <div style={{ fontSize: "10px", color: "#1e2d3d", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: "10px" }}>
                Recent — {history.length} analyzed
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {history.slice(0, 5).map((h, i) => {
                  const lv = getToxicityLevel(h.result.confidence, h.result.toxic);
                  return (
                    <button key={i} onClick={() => { setText(h.text); setResult(h.result); }} style={{
                      display: "flex", alignItems: "center", gap: "11px",
                      padding: "9px 13px", borderRadius: "11px",
                      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                      cursor: "pointer", textAlign: "left", transition: "background 0.15s",
                    }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                    >
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: lv.color, flexShrink: 0 }}/>
                      <span style={{ flex: 1, fontSize: "12px", color: "#2d3a47", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.text}</span>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: lv.color, flexShrink: 0 }}>{lv.label}</span>
                      <span style={{ fontSize: "10px", color: "#1e2d3d", flexShrink: 0 }}>{Math.round(h.result.confidence * 100)}%</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      { }
      {activeTab === "dashboard" && (
        <div style={{ maxWidth: "820px", margin: "0 auto", padding: "40px 20px 80px", position: "relative", zIndex: 1 }}>
          <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#e2ecf5", letterSpacing: "-0.03em", margin: "0 0 6px" }}>Dashboard</h2>
          <p style={{ color: "#2d3a47", fontSize: "13px", marginBottom: "28px" }}>
            {totalAnalyzed === 0 ? "No comments analyzed yet — use the Analyze tab to get started." : `${totalAnalyzed} comment${totalAnalyzed !== 1 ? "s" : ""} analyzed this session.`}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px", marginBottom: "20px" }}>
            <StatCard label="Total Analyzed" value={totalAnalyzed} color="#6382af"/>
            <StatCard label="Toxic" value={toxicCount} color="#f87171"/>
            <StatCard label="Safe" value={totalAnalyzed - toxicCount} color="#34d399"/>
            <StatCard label="Avg Score" value={`${avgScore}%`} color="#fbbf24"/>
          </div>

          { }
          {totalAnalyzed > 0 && (
            <div style={{ background: "rgba(10,14,26,0.95)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "16px", padding: "22px", marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", color: "#1e2d3d", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: "16px" }}>
                Breakdown by Level
              </div>
              {[
                { label: "Safe",           color: "#34d399", tier: 0 },
                { label: "Mildly Toxic",   color: "#fbbf24", tier: 1 },
                { label: "Toxic",          color: "#fb923c", tier: 2 },
                { label: "Extremely Toxic",color: "#f87171", tier: 3 },
              ].map(({ label, color, tier }) => {
                const count = history.filter((h) => getToxicityLevel(h.result.confidence, h.result.toxic).tier === tier).length;
                return (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "9px" }}>
                    <span style={{ fontSize: "12px", color: "#2d3a47", width: "105px", flexShrink: 0 }}>{label}</span>
                    <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.04)", borderRadius: "999px", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", background: color, borderRadius: "999px",
                        width: `${(count / totalAnalyzed) * 100}%`,
                        transition: "width 0.7s cubic-bezier(0.16,1,0.3,1)",
                      }}/>
                    </div>
                    <span style={{ fontSize: "12px", color, fontWeight: 700, width: "24px", textAlign: "right" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          )}

          { }
          <div style={{ background: "rgba(10,14,26,0.95)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "16px", padding: "22px", marginBottom: "16px" }}>
            <div style={{ fontSize: "10px", color: "#1e2d3d", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: "14px" }}>Most Flagged Terms</div>
            <TopWordsBar words={topWords} />
          </div>

          { }
          {history.length > 0 && (
            <div style={{ background: "rgba(10,14,26,0.95)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "16px", padding: "22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <div style={{ fontSize: "10px", color: "#1e2d3d", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>Comment Log</div>
                <button onClick={() => { setHistory([]); setResult(null); }} style={{
                  fontSize: "12px", color: "#1e2d3d", background: "none", border: "none", cursor: "pointer", padding: "3px 8px", borderRadius: "6px",
                }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#1e2d3d")}
                >Clear</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "5px", maxHeight: "320px", overflowY: "auto" }}>
                {history.map((h, i) => {
                  const lv = getToxicityLevel(h.result.confidence, h.result.toxic);
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "8px 12px", borderRadius: "9px",
                      background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)",
                    }}>
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: lv.color, flexShrink: 0 }}/>
                      <span style={{ flex: 1, fontSize: "12px", color: "#2d3a47", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.text}</span>
                      <span style={{ fontSize: "11px", color: lv.color, fontWeight: 700, flexShrink: 0, minWidth: "80px", textAlign: "right" }}>{lv.label}</span>
                      <span style={{ fontSize: "10px", color: "#1e2d3d", flexShrink: 0 }}>{Math.round(h.result.confidence * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        textarea::placeholder { color: #1a2535 !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }
      `}</style>
    </div>
  );
}