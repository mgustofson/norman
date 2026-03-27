import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────
// Agent definitions with full system prompts
// ─────────────────────────────────────────────────────────────

const PIPELINE = [
  {
    id: "research",
    name: "Research",
    role: "Research Agent",
    color: "#2D7DD2",
    icon: "◎",
    systemPrompt: `You are a design research specialist on a team called Norman. Your job is to deliver specific, sourced competitive intelligence and market insights that will inform the next stage of design work.

When given a design brief:
1. Identify the 3-5 most relevant competitors or analogous products
2. For each, describe specific UX patterns, design choices, and approaches — not just feature lists
3. Identify convergent patterns (what everyone does) and differentiators (what's unique)
4. Call out gaps — things nobody is doing well that represent opportunities
5. Note any emerging trends relevant to this space

Be specific. Name companies, describe actual interfaces, reference real patterns. "Competitors use cards" is useless. "Airbnb uses a horizontally scrolling card carousel with lazy-loaded images, 16px gutters, and a subtle parallax on scroll" is useful.

Structure your response as:
- LANDSCAPE: Who are the players and how do they approach this problem?
- PATTERNS: What's table stakes vs. differentiating?
- GAPS & OPPORTUNITIES: What's nobody doing well?
- KEY INSIGHTS: The 3-5 things the design team needs to know

Keep it focused and actionable — this feeds directly into ideation.`,
    buildPrompt: (brief) =>
      `Design brief: "${brief}"\n\nConduct competitive and landscape research to inform the design of this. Focus on UX patterns, design approaches, and opportunities. Be specific with real examples.`,
  },
  {
    id: "ideation",
    name: "Ideation",
    role: "Design Partner",
    color: "#E8553A",
    icon: "◈",
    systemPrompt: `You are a senior design partner on a team called Norman. You receive research context from the Research Agent and your job is to generate bold, divergent concept directions.

Given the research findings and the original brief:
1. Generate exactly 3 distinct directions — not variations of one idea, but fundamentally different approaches
2. Each direction should have:
   - A memorable name (2-3 words)
   - A one-sentence concept statement
   - The core insight or bet: what belief about users drives this direction?
   - Key moments: describe 2-3 specific interactions or screens vividly enough to visualize
   - What it trades off: every direction sacrifices something — name it
3. Make at least one direction feel unexpected or provocative
4. Reference the research findings — show that the directions are informed by what exists, not invented in a vacuum

Don't hedge or qualify everything. Have a point of view. If one direction is clearly strongest, say so — but still make the others genuinely compelling alternatives.

End with a brief recommendation: which direction would you push forward and why?`,
    buildPrompt: (brief, prevOutputs) =>
      `Original brief: "${brief}"\n\n--- RESEARCH FINDINGS ---\n${prevOutputs.research}\n--- END RESEARCH ---\n\nBased on this research, generate 3 bold concept directions for this design challenge. Be specific and vivid.`,
  },
  {
    id: "production",
    name: "Production",
    role: "Production Design",
    color: "#45B69C",
    icon: "◆",
    systemPrompt: `You are a production design specialist on a team called Norman. You receive research context and concept directions from the earlier stages. Your job is to take the recommended direction and produce a detailed, production-ready design specification.

Given the research, concept directions, and the original brief:
1. Identify the recommended direction (or the strongest one if no recommendation was made)
2. Produce a complete design specification including:

TYPE SYSTEM:
- Font selections with rationale (display + body)
- Full type scale with sizes, weights, line heights, letter-spacing
- Hierarchy rules

COLOR SYSTEM:
- Semantic color tokens (primary, secondary, success, warning, error, neutral)
- Full shade scale for each (50-900)
- Specific hex values
- Contrast ratios for key pairings

SPACING SYSTEM:
- Base unit and full scale
- Component-level spacing rules (card padding, section gaps, etc.)

KEY COMPONENTS:
- Describe 2-3 core components with specific dimensions, states, and behavior
- Include hover, active, disabled states
- Border radius philosophy
- Shadow system

LAYOUT:
- Grid structure
- Responsive breakpoints
- Key page compositions

Keep everything specific — exact values, exact hex codes, exact pixel measurements. This should be implementable without interpretation.`,
    buildPrompt: (brief, prevOutputs) =>
      `Original brief: "${brief}"\n\n--- RESEARCH FINDINGS ---\n${prevOutputs.research}\n--- END RESEARCH ---\n\n--- CONCEPT DIRECTIONS ---\n${prevOutputs.ideation}\n--- END CONCEPTS ---\n\nTake the strongest concept direction and produce a complete, production-ready design specification. Be precise with values — hex codes, pixel measurements, font weights, ratios. This needs to be implementable.`,
  },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function callClaude(systemPrompt, userMessage) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.map((b) => (b.type === "text" ? b.text : "")).join("\n") || "";
}

// ─────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────

function StageIndicator({ stage, status, isActive, color, icon, elapsed }) {
  const statusColors = {
    pending: "rgba(255,255,255,0.12)",
    running: color,
    done: color,
    error: "#E8553A",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        opacity: status === "pending" ? 0.35 : 1,
        transition: "opacity 0.4s ease",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: status === "done" ? color : status === "running" ? `${color}30` : "rgba(255,255,255,0.04)",
          border: `1.5px solid ${statusColors[status]}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          color: status === "pending" ? "rgba(255,255,255,0.2)" : "#fff",
          transition: "all 0.4s ease",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {status === "running" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(135deg, transparent 40%, ${color}40 50%, transparent 60%)`,
              animation: "shimmer 1.5s infinite",
            }}
          />
        )}
        <span style={{ position: "relative", zIndex: 1 }}>{status === "done" ? "✓" : icon}</span>
      </div>
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: status === "pending" ? "rgba(255,255,255,0.3)" : "#fff",
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "-0.01em",
          }}
        >
          {stage.name}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
          {status === "running"
            ? `Working${elapsed ? ` · ${elapsed}s` : "..."}`
            : status === "done"
              ? `Complete${elapsed ? ` · ${elapsed}s` : ""}`
              : stage.role}
        </div>
      </div>
    </div>
  );
}

function OutputSection({ stage, content, isExpanded, onToggle }) {
  const previewLength = 300;
  const needsTruncation = content.length > previewLength;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${stage.color}25`,
        borderRadius: 10,
        overflow: "hidden",
        transition: "all 0.3s ease",
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          padding: "12px 16px",
          background: `${stage.color}08`,
          border: "none",
          borderBottom: isExpanded ? `1px solid ${stage.color}15` : "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 12, color: stage.color }}>{stage.icon}</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#fff",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {stage.role}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "rgba(255,255,255,0.3)",
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        >
          ▼
        </span>
      </button>
      {isExpanded && (
        <div
          style={{
            padding: 16,
            fontSize: 13,
            lineHeight: 1.65,
            color: "rgba(255,255,255,0.75)",
            whiteSpace: "pre-wrap",
            maxHeight: 500,
            overflow: "auto",
          }}
        >
          {content}
        </div>
      )}
      {!isExpanded && content && (
        <div
          style={{
            padding: "10px 16px",
            fontSize: 12,
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.35)",
            whiteSpace: "pre-wrap",
            overflow: "hidden",
          }}
        >
          {content.slice(0, previewLength)}
          {needsTruncation && "..."}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────

export default function NormanPipeline() {
  const [brief, setBrief] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [stages, setStages] = useState(
    PIPELINE.map((s) => ({ ...s, status: "pending", output: "", elapsed: null }))
  );
  const [expandedStage, setExpandedStage] = useState(null);
  const [error, setError] = useState(null);
  const [totalTime, setTotalTime] = useState(null);
  const [history, setHistory] = useState([]);
  const timerRef = useRef(null);
  const elapsedRef = useRef(0);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const [activeStageIndex, setActiveStageIndex] = useState(-1);

  // Load history
  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.get("norman-pipeline-history");
        if (result?.value) setHistory(JSON.parse(result.value));
      } catch (e) { /* first run */ }
    })();
  }, []);

  const runPipeline = useCallback(async () => {
    if (!brief.trim() || isRunning) return;
    setIsRunning(true);
    setError(null);
    setTotalTime(null);
    setExpandedStage(null);

    const startTime = Date.now();
    const outputs = {};

    // Reset stages
    setStages(PIPELINE.map((s) => ({ ...s, status: "pending", output: "", elapsed: null })));

    for (let i = 0; i < PIPELINE.length; i++) {
      const stage = PIPELINE[i];
      setActiveStageIndex(i);
      elapsedRef.current = 0;
      setLiveElapsed(0);

      // Start timer
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setLiveElapsed(elapsedRef.current);
      }, 1000);

      // Set running
      setStages((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "running" } : s))
      );

      try {
        const userMessage = stage.buildPrompt(brief, outputs);
        const output = await callClaude(stage.systemPrompt, userMessage);
        outputs[stage.id] = output;

        clearInterval(timerRef.current);
        const stageElapsed = elapsedRef.current;

        setStages((prev) =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: "done", output, elapsed: stageElapsed } : s
          )
        );

        // Auto-expand the latest completed stage
        setExpandedStage(stage.id);
      } catch (err) {
        clearInterval(timerRef.current);
        setStages((prev) =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: "error", output: err.message } : s
          )
        );
        setError(`${stage.name} failed: ${err.message}`);
        break;
      }
    }

    const total = Math.round((Date.now() - startTime) / 1000);
    setTotalTime(total);
    setIsRunning(false);
    setActiveStageIndex(-1);

    // Save to history
    try {
      const entry = {
        id: Date.now(),
        brief,
        timestamp: new Date().toISOString(),
        totalTime: total,
        outputs,
      };
      const newHistory = [entry, ...history].slice(0, 20);
      setHistory(newHistory);
      await window.storage.set("norman-pipeline-history", JSON.stringify(newHistory));
    } catch (e) { /* storage not available */ }
  }, [brief, isRunning, history]);

  const allDone = stages.every((s) => s.status === "done");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0A0A0D",
        color: "#fff",
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "28px 32px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "linear-gradient(135deg, #2D7DD2, #E8553A, #45B69C)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            N
          </div>
          <h1
            style={{
              fontSize: 18,
              fontWeight: 700,
              margin: 0,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "-0.03em",
            }}
          >
            Norman
          </h1>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginLeft: 4 }}>
            Pipeline
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 32px" }}>
        {/* Brief input */}
        <div style={{ marginBottom: 28 }}>
          <label
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(255,255,255,0.3)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              display: "block",
              marginBottom: 10,
            }}
          >
            Design Brief
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey) runPipeline();
              }}
              placeholder="Describe what you want Norman to design..."
              disabled={isRunning}
              rows={2}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                padding: "12px 14px",
                color: "#fff",
                fontSize: 14,
                lineHeight: 1.5,
                resize: "none",
                outline: "none",
                fontFamily: "inherit",
                transition: "border-color 0.2s",
              }}
            />
            <button
              onClick={runPipeline}
              disabled={isRunning || !brief.trim()}
              style={{
                padding: "0 24px",
                background: isRunning || !brief.trim()
                  ? "rgba(255,255,255,0.04)"
                  : "linear-gradient(135deg, #2D7DD2, #45B69C)",
                border: "none",
                borderRadius: 10,
                color: isRunning || !brief.trim() ? "rgba(255,255,255,0.2)" : "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: isRunning || !brief.trim() ? "default" : "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                transition: "all 0.2s",
              }}
            >
              {isRunning ? "Running..." : "Build →"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 6 }}>
            ⌘ + Enter to run
          </div>
        </div>

        {/* Pipeline stages */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 28 }}>
          {stages.map((stage, i) => (
            <div key={stage.id}>
              <StageIndicator
                stage={stage}
                status={stage.status}
                isActive={i === activeStageIndex}
                color={stage.color}
                icon={stage.icon}
                elapsed={
                  i === activeStageIndex && isRunning
                    ? liveElapsed
                    : stage.elapsed
                }
              />
              {i < stages.length - 1 && (
                <div
                  style={{
                    width: 1.5,
                    height: 20,
                    background:
                      stage.status === "done"
                        ? `linear-gradient(to bottom, ${stage.color}, ${stages[i + 1].color})`
                        : "rgba(255,255,255,0.06)",
                    marginLeft: 15,
                    transition: "background 0.4s ease",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Completion banner */}
        {allDone && totalTime && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(69,182,156,0.08)",
              border: "1px solid rgba(69,182,156,0.2)",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 24,
              animation: "fadeIn 0.4s ease",
            }}
          >
            <span style={{ fontSize: 14 }}>✓</span>
            <span style={{ fontSize: 13, color: "#45B69C", fontWeight: 500 }}>
              Pipeline complete
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: "rgba(255,255,255,0.35)",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {totalTime}s total
            </span>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(232,85,58,0.08)",
              border: "1px solid rgba(232,85,58,0.25)",
              borderRadius: 10,
              fontSize: 12,
              color: "#E8553A",
              marginBottom: 24,
            }}
          >
            {error}
          </div>
        )}

        {/* Outputs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {stages
            .filter((s) => s.output && s.status !== "error")
            .map((stage) => (
              <OutputSection
                key={stage.id}
                stage={stage}
                content={stage.output}
                isExpanded={expandedStage === stage.id}
                onToggle={() =>
                  setExpandedStage(expandedStage === stage.id ? null : stage.id)
                }
              />
            ))}
        </div>

        {/* Previous runs */}
        {history.length > 0 && !isRunning && stages.every((s) => s.status === "pending") && (
          <div style={{ marginTop: 40 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(255,255,255,0.2)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Recent runs
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {history.slice(0, 5).map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setBrief(h.brief);
                    // Restore outputs
                    setStages(
                      PIPELINE.map((s) => ({
                        ...s,
                        status: h.outputs[s.id] ? "done" : "pending",
                        output: h.outputs[s.id] || "",
                        elapsed: null,
                      }))
                    );
                    setExpandedStage("production");
                    setTotalTime(h.totalTime);
                  }}
                  style={{
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    borderRadius: 8,
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", flex: 1 }}>
                    {h.brief.length > 70 ? h.brief.slice(0, 70) + "..." : h.brief}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.2)",
                      fontFamily: "'JetBrains Mono', monospace",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h.totalTime}s · {new Date(h.timestamp).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        textarea:focus { border-color: rgba(255,255,255,0.2) !important; }
      `}</style>
    </div>
  );
}
