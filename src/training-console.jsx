import { useState, useEffect, useCallback, useRef } from "react";

const AGENTS = [
  {
    id: "design-partner",
    name: "Design Partner",
    color: "#E8553A",
    description: "Ideation, divergent thinking, creative exploration",
    testPrompts: [
      "I'm designing a travel booking app and the checkout flow feels too transactional. Help me think about how to make it feel more like planning an adventure.",
      "We have a dashboard that shows 15 different metrics. Users say they feel overwhelmed. What are some directions we could take?",
      "I'm stuck on how to handle empty states in a social product where new users have no content yet.",
    ],
  },
  {
    id: "research-agent",
    name: "Research Agent",
    color: "#2D7DD2",
    description: "Competitive analysis, market intelligence, evidence gathering",
    testPrompts: [
      "How are Booking.com, Airbnb, and Expedia handling AI-powered trip planning right now? I want specifics on their UX patterns.",
      "What are the dominant onboarding patterns in fintech apps targeting small businesses?",
      "Research how the top 5 design tools (Figma, Sketch, etc.) handle their plugin/extension marketplaces.",
    ],
  },
  {
    id: "production-design",
    name: "Production Design",
    color: "#45B69C",
    description: "Craft, polish, typography, spacing, visual systems",
    testPrompts: [
      "I have a card component with a title, subtitle, thumbnail, and action button. The spacing feels off and the hierarchy is unclear. Help me tighten it up.",
      "Review this type system: H1 is 36px, H2 is 24px, H3 is 18px, body is 16px, caption is 12px. All using Inter. What would you change?",
      "I need a color system for a health-tech product. Clean and trustworthy but not cold. Build me the semantic tokens.",
    ],
  },
  {
    id: "training-agent",
    name: "Training Agent",
    color: "#9B5DE5",
    description: "Evaluates and improves the other agents",
    testPrompts: [
      "The Design Partner gave me very generic brainstorming output on my last project — it felt like it could apply to any product. How do we fix that?",
      "I want the Research Agent to be better at citing specific sources and less likely to rely on general knowledge. What should we change in its skill file?",
      "Propose a new agent for the team that handles design systems and component documentation.",
    ],
  },
];

const EVAL_CRITERIA = [
  { id: "specificity", label: "Specificity", desc: "Concrete and contextual vs. generic" },
  { id: "role_fidelity", label: "Role Fidelity", desc: "Stayed in lane, didn't bleed into other agents' work" },
  { id: "depth", label: "Depth", desc: "Went beyond surface-level into real substance" },
  { id: "voice", label: "Voice", desc: "Distinctive, appropriate tone for the role" },
  { id: "actionability", label: "Actionability", desc: "Output you could actually use in your work" },
];

const TRAINING_SYSTEM_PROMPT = `You are a Training Agent that evaluates and improves design team AI agents. You will be given an agent's SKILL.md instructions and a test output from that agent.

Evaluate the output against these criteria, scoring each 1-5:
- Specificity: Is the output concrete and contextual, or could it apply to any product?
- Role Fidelity: Did the agent stay in its lane, or bleed into other agents' territory?
- Depth: Did it go beyond surface-level into real substance?
- Voice: Does it have a distinctive, appropriate tone for the role?
- Actionability: Could you actually use this output in your work?

Respond ONLY with a JSON object (no markdown fences, no preamble):
{
  "scores": {
    "specificity": <1-5>,
    "role_fidelity": <1-5>,
    "depth": <1-5>,
    "voice": <1-5>,
    "actionability": <1-5>
  },
  "overall": <1-5>,
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"],
  "suggested_skill_changes": [
    {
      "section": "<which section of SKILL.md to modify>",
      "change": "<specific change to make>",
      "reasoning": "<why this would improve performance>"
    }
  ],
  "summary": "<2-3 sentence overall assessment>"
}`;

function ScoreBar({ score, max = 5, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", gap: 2 }}>
        {Array.from({ length: max }, (_, i) => (
          <div
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: i < score ? color : "rgba(255,255,255,0.08)",
              transition: "background 0.3s ease",
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontVariantNumeric: "tabular-nums" }}>
        {score}/{max}
      </span>
    </div>
  );
}

function AgentCard({ agent, isSelected, onClick, lastScore }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: isSelected ? `${agent.color}18` : "rgba(255,255,255,0.03)",
        border: `1px solid ${isSelected ? agent.color : "rgba(255,255,255,0.06)"}`,
        borderRadius: 10,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.2s ease",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: agent.color }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>
          {agent.name}
        </span>
        {lastScore != null && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              fontWeight: 600,
              color: lastScore >= 4 ? "#45B69C" : lastScore >= 3 ? "#F4A261" : "#E8553A",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {lastScore.toFixed(1)}
          </span>
        )}
      </div>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", margin: 0, lineHeight: 1.4 }}>
        {agent.description}
      </p>
    </button>
  );
}

export default function AgentTrainingConsole() {
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [activeTab, setActiveTab] = useState("evaluate");
  const [testPrompt, setTestPrompt] = useState("");
  const [agentOutput, setAgentOutput] = useState("");
  const [evaluation, setEvaluation] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [generationStep, setGenerationStep] = useState("");
  const [trainingHistory, setTrainingHistory] = useState([]);
  const [skillContent, setSkillContent] = useState({});
  const [error, setError] = useState(null);
  const outputRef = useRef(null);

  // Load training history from persistent storage
  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.get("training-history");
        if (result?.value) setTrainingHistory(JSON.parse(result.value));
      } catch (e) { /* no history yet */ }
      try {
        const result = await window.storage.get("skill-content");
        if (result?.value) setSkillContent(JSON.parse(result.value));
      } catch (e) { /* no skills cached */ }
    })();
  }, []);

  const saveHistory = useCallback(async (newHistory) => {
    setTrainingHistory(newHistory);
    try {
      await window.storage.set("training-history", JSON.stringify(newHistory));
    } catch (e) { console.error("Failed to save history:", e); }
  }, []);

  const getAgentSystemPrompt = (agent) => {
    if (skillContent[agent.id]) return skillContent[agent.id];
    // Fallback inline prompts if no custom skill content loaded
    const prompts = {
      "design-partner": `You are a senior design partner. Your job is to expand the solution space, challenge assumptions, and help arrive at ideas the user wouldn't reach alone. Generate multiple directions (3-5), each with a memorable name, core insight, and tradeoffs. Reference broadly — pull from industrial design, architecture, game design, psychology, not just other apps. Be direct, opinionated but curious, and use vivid descriptions. Don't deliver finished specs; deliver creative fuel.`,
      "research-agent": `You are a design research specialist. Your job is to deliver specific, sourced competitive intelligence and market insights. Be precise about what you found vs. what you're inferring. Describe HOW competitors implement features, not just WHAT features they have. Structure findings around the user's decision. Always cite specific companies, products, and details.`,
      "production-design": `You are a production design craftsperson. Your job is to elevate designs from "works" to "exceptional" through typography systems (modular scales, proper line heights), spacing (4/8px base unit grids), color (semantic tokens with shade scales), hierarchy, and component craft. Be specific with values — say "bump from 500 to 700 weight" not "make it bolder". Explain the principle behind each change.`,
      "training-agent": `You are a training agent that evaluates and improves other design AI agents. Diagnose root causes in agent instructions, propose specific SKILL.md changes, and design test exercises. Be direct, systems-oriented, and evidence-based.`,
    };
    return prompts[agent.id] || "";
  };

  const callAPI = async (systemPrompt, userMessage) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error ${response.status}: ${err}`);
    }
    return response.json();
  };

  const generateAgentOutput = async () => {
    if (!selectedAgent || !testPrompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    setAgentOutput("");
    setEvaluation(null);
    setGenerationStep("Running agent...");

    try {
      const systemPrompt = getAgentSystemPrompt(selectedAgent);
      const data = await callAPI(systemPrompt, testPrompt);
      const text = data.content?.map((b) => (b.type === "text" ? b.text : "")).join("\n") || "";
      setAgentOutput(text);
      setGenerationStep("");
    } catch (e) {
      setError(e.message);
      setGenerationStep("");
    } finally {
      setIsGenerating(false);
    }
  };

  const evaluateOutput = async () => {
    if (!agentOutput || !selectedAgent) return;
    setIsEvaluating(true);
    setError(null);
    setGenerationStep("Evaluating output...");

    try {
      const userMsg = `Agent: ${selectedAgent.name}
Agent's SKILL.md system prompt:
---
${getAgentSystemPrompt(selectedAgent)}
---

Test prompt given to agent:
"${testPrompt}"

Agent's output:
---
${agentOutput}
---

Evaluate this output.`;

      const data = await callAPI(TRAINING_SYSTEM_PROMPT, userMsg);
      const text = data.content?.map((b) => (b.type === "text" ? b.text : "")).join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setEvaluation(parsed);

      // Save to history
      const entry = {
        id: Date.now(),
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        prompt: testPrompt,
        overall: parsed.overall,
        scores: parsed.scores,
        summary: parsed.summary,
        suggestions: parsed.suggested_skill_changes,
        timestamp: new Date().toISOString(),
      };
      await saveHistory([entry, ...trainingHistory]);
      setGenerationStep("");
    } catch (e) {
      setError(`Eval failed: ${e.message}`);
      setGenerationStep("");
    } finally {
      setIsEvaluating(false);
    }
  };

  const getLastScore = (agentId) => {
    const entry = trainingHistory.find((h) => h.agentId === agentId);
    return entry?.overall ?? null;
  };

  const agentHistory = trainingHistory.filter((h) => h.agentId === selectedAgent?.id);

  const avgScore = agentHistory.length
    ? (agentHistory.reduce((s, h) => s + h.overall, 0) / agentHistory.length).toFixed(1)
    : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0C0C0F",
        color: "#fff",
        fontFamily: "'Inter', -apple-system, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "linear-gradient(135deg, #9B5DE5, #E8553A)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
          }}
        >
          ◆
        </div>
        <div>
          <h1
            style={{
              fontSize: 16,
              fontWeight: 700,
              margin: 0,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "-0.02em",
            }}
          >
            Agent Training Console
          </h1>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0 }}>
            Evaluate · Diagnose · Improve
          </p>
        </div>
        {trainingHistory.length > 0 && (
          <div style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
            {trainingHistory.length} eval{trainingHistory.length !== 1 ? "s" : ""} recorded
          </div>
        )}
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div
          style={{
            width: 240,
            borderRight: "1px solid rgba(255,255,255,0.06)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
            Agents
          </span>
          {AGENTS.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isSelected={selectedAgent?.id === agent.id}
              onClick={() => {
                setSelectedAgent(agent);
                setTestPrompt("");
                setAgentOutput("");
                setEvaluation(null);
                setError(null);
              }}
              lastScore={getLastScore(agent.id)}
            />
          ))}

          {selectedAgent && agentHistory.length > 0 && (
            <div style={{ marginTop: "auto", padding: "12px 0" }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Trend
              </span>
              <div style={{ display: "flex", gap: 3, marginTop: 8, alignItems: "flex-end", height: 40 }}>
                {agentHistory
                  .slice(0, 12)
                  .reverse()
                  .map((h, i) => (
                    <div
                      key={h.id}
                      style={{
                        width: 12,
                        height: `${(h.overall / 5) * 100}%`,
                        minHeight: 4,
                        borderRadius: 2,
                        background: selectedAgent.color,
                        opacity: 0.4 + (i / 12) * 0.6,
                      }}
                      title={`${h.overall}/5 — ${new Date(h.timestamp).toLocaleDateString()}`}
                    />
                  ))}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
                Avg: {avgScore}/5 over {agentHistory.length} evals
              </div>
            </div>
          )}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {!selectedAgent ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.2)",
                fontSize: 14,
              }}
            >
              Select an agent to begin training
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingLeft: 24 }}>
                {["evaluate", "history"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: "12px 20px",
                      background: "none",
                      border: "none",
                      borderBottom: activeTab === tab ? `2px solid ${selectedAgent.color}` : "2px solid transparent",
                      color: activeTab === tab ? "#fff" : "rgba(255,255,255,0.35)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {activeTab === "evaluate" && (
                <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
                  {/* Test prompt */}
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
                      Test Prompt
                    </label>
                    <textarea
                      value={testPrompt}
                      onChange={(e) => setTestPrompt(e.target.value)}
                      placeholder="Enter a prompt to test this agent, or pick one below..."
                      style={{
                        width: "100%",
                        minHeight: 80,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 8,
                        padding: 14,
                        color: "#fff",
                        fontSize: 13,
                        lineHeight: 1.5,
                        resize: "vertical",
                        outline: "none",
                        fontFamily: "inherit",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {selectedAgent.testPrompts.map((p, i) => (
                        <button
                          key={i}
                          onClick={() => setTestPrompt(p)}
                          style={{
                            padding: "5px 10px",
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 6,
                            color: "rgba(255,255,255,0.5)",
                            fontSize: 11,
                            cursor: "pointer",
                            maxWidth: 220,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={p}
                        >
                          Prompt {i + 1}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
                    <button
                      onClick={generateAgentOutput}
                      disabled={isGenerating || !testPrompt.trim()}
                      style={{
                        padding: "10px 20px",
                        background: selectedAgent.color,
                        border: "none",
                        borderRadius: 8,
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: isGenerating || !testPrompt.trim() ? "default" : "pointer",
                        opacity: isGenerating || !testPrompt.trim() ? 0.4 : 1,
                        transition: "opacity 0.2s",
                      }}
                    >
                      {isGenerating ? "Running..." : "1. Run Agent"}
                    </button>
                    <button
                      onClick={evaluateOutput}
                      disabled={isEvaluating || !agentOutput}
                      style={{
                        padding: "10px 20px",
                        background: "rgba(255,255,255,0.06)",
                        border: `1px solid ${agentOutput ? selectedAgent.color : "rgba(255,255,255,0.1)"}`,
                        borderRadius: 8,
                        color: agentOutput ? "#fff" : "rgba(255,255,255,0.3)",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: isEvaluating || !agentOutput ? "default" : "pointer",
                        opacity: isEvaluating || !agentOutput ? 0.4 : 1,
                        transition: "opacity 0.2s",
                      }}
                    >
                      {isEvaluating ? "Evaluating..." : "2. Evaluate"}
                    </button>
                  </div>

                  {generationStep && (
                    <div style={{ fontSize: 12, color: selectedAgent.color, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: selectedAgent.color, animation: "pulse 1s infinite" }} />
                      {generationStep}
                    </div>
                  )}

                  {error && (
                    <div style={{ padding: 12, background: "rgba(232,85,58,0.1)", border: "1px solid rgba(232,85,58,0.3)", borderRadius: 8, fontSize: 12, color: "#E8553A", marginBottom: 16 }}>
                      {error}
                    </div>
                  )}

                  {/* Agent output */}
                  {agentOutput && (
                    <div style={{ marginBottom: 24 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
                        Agent Output
                      </label>
                      <div
                        ref={outputRef}
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          borderRadius: 8,
                          padding: 16,
                          fontSize: 13,
                          lineHeight: 1.6,
                          color: "rgba(255,255,255,0.8)",
                          maxHeight: 300,
                          overflow: "auto",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {agentOutput}
                      </div>
                    </div>
                  )}

                  {/* Evaluation results */}
                  {evaluation && (
                    <div
                      style={{
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 12,
                        padding: 20,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Evaluation</span>
                        <span
                          style={{
                            fontSize: 20,
                            fontWeight: 700,
                            color: evaluation.overall >= 4 ? "#45B69C" : evaluation.overall >= 3 ? "#F4A261" : "#E8553A",
                            fontFamily: "'JetBrains Mono', monospace",
                            marginLeft: "auto",
                          }}
                        >
                          {evaluation.overall}/5
                        </span>
                      </div>

                      {/* Score breakdown */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 20 }}>
                        {EVAL_CRITERIA.map((c) => (
                          <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{c.label}</span>
                            <ScoreBar score={evaluation.scores?.[c.id] || 0} color={selectedAgent.color} />
                          </div>
                        ))}
                      </div>

                      {/* Summary */}
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.5, margin: "0 0 16px" }}>
                        {evaluation.summary}
                      </p>

                      {/* Strengths & Weaknesses */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#45B69C", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            Strengths
                          </span>
                          {evaluation.strengths?.map((s, i) => (
                            <p key={i} style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "6px 0 0", lineHeight: 1.4 }}>
                              {s}
                            </p>
                          ))}
                        </div>
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#E8553A", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            Weaknesses
                          </span>
                          {evaluation.weaknesses?.map((w, i) => (
                            <p key={i} style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "6px 0 0", lineHeight: 1.4 }}>
                              {w}
                            </p>
                          ))}
                        </div>
                      </div>

                      {/* Suggested changes */}
                      {evaluation.suggested_skill_changes?.length > 0 && (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            Suggested SKILL.md Changes
                          </span>
                          {evaluation.suggested_skill_changes.map((change, i) => (
                            <div
                              key={i}
                              style={{
                                marginTop: 10,
                                padding: 12,
                                background: "rgba(255,255,255,0.03)",
                                borderRadius: 8,
                                borderLeft: `3px solid ${selectedAgent.color}`,
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                                {change.section}
                              </div>
                              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", margin: "0 0 4px", lineHeight: 1.4 }}>
                                {change.change}
                              </p>
                              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0, fontStyle: "italic" }}>
                                {change.reasoning}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "history" && (
                <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
                  {agentHistory.length === 0 ? (
                    <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 13, textAlign: "center", paddingTop: 60 }}>
                      No evaluations recorded for {selectedAgent.name} yet
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {agentHistory.map((h) => (
                        <div
                          key={h.id}
                          style={{
                            padding: 14,
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            borderRadius: 10,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                              {new Date(h.timestamp).toLocaleString()}
                            </span>
                            <span
                              style={{
                                fontSize: 14,
                                fontWeight: 700,
                                color: h.overall >= 4 ? "#45B69C" : h.overall >= 3 ? "#F4A261" : "#E8553A",
                                fontFamily: "'JetBrains Mono', monospace",
                              }}
                            >
                              {h.overall}/5
                            </span>
                          </div>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "0 0 8px", lineHeight: 1.4 }}>
                            "{h.prompt.length > 120 ? h.prompt.slice(0, 120) + "..." : h.prompt}"
                          </p>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", margin: 0, lineHeight: 1.4 }}>
                            {h.summary}
                          </p>
                          {h.suggestions?.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 11, color: selectedAgent.color }}>
                              {h.suggestions.length} suggested change{h.suggestions.length !== 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {trainingHistory.length > 0 && (
                    <button
                      onClick={async () => {
                        if (confirm("Clear all training history? This cannot be undone.")) {
                          await saveHistory([]);
                        }
                      }}
                      style={{
                        marginTop: 24,
                        padding: "8px 16px",
                        background: "none",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 6,
                        color: "rgba(255,255,255,0.3)",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      Clear history
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      `}</style>
    </div>
  );
}
