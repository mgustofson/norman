#!/usr/bin/env node

/**
 * Norman — Agent Evaluator
 *
 * Runs a single agent against a test prompt, then evaluates the output
 * using the Training Agent.
 *
 * Usage:
 *   node scripts/evaluate.js --agent design-partner --prompt "Help me brainstorm..."
 *   node scripts/evaluate.js --agent research-agent --prompt "How does Airbnb handle..."
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AGENTS = [
  "design-partner",
  "research-agent",
  "production-design",
  "training-agent",
];

const EVAL_CRITERIA = [
  "specificity",
  "role_fidelity",
  "depth",
  "voice",
  "actionability",
];

const TRAINING_SYSTEM_PROMPT = `You are a Training Agent that evaluates design team AI agents. You will receive an agent's SKILL.md instructions, the test prompt it was given, and its output.

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadSkill(agentId) {
  const skillPath = join(ROOT, "skills", agentId, "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error(`Skill file not found: ${skillPath}`);
  }
  return readFileSync(skillPath, "utf-8");
}

function extractSystemPrompt(skillContent) {
  // Strip YAML frontmatter and use the body as the system prompt
  const withoutFrontmatter = skillContent.replace(/^---[\s\S]*?---\n*/m, "");
  return withoutFrontmatter.trim();
}

function saveResult(agentId, result) {
  const historyDir = join(ROOT, "training-history");
  mkdirSync(historyDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${agentId}_${timestamp}.json`;
  const filepath = join(historyDir, filename);

  writeFileSync(filepath, JSON.stringify(result, null, 2));
  return filepath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function evaluate(agentId, prompt) {
  const client = new Anthropic();

  // 1. Load the agent's skill
  console.log(`\n◆ Norman — Evaluating: ${agentId}`);
  console.log(`  Prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"\n`);

  const skillContent = loadSkill(agentId);
  const systemPrompt = extractSystemPrompt(skillContent);

  // 2. Run the agent
  console.log("  ① Running agent...");
  const agentResponse = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });

  const agentOutput = agentResponse.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");

  console.log(`    Output: ${agentOutput.length} chars`);

  // 3. Evaluate with Training Agent
  console.log("  ② Evaluating output...");
  const evalMessage = `Agent: ${agentId}

Agent's SKILL.md:
---
${skillContent}
---

Test prompt:
"${prompt}"

Agent's output:
---
${agentOutput}
---

Evaluate this output.`;

  const evalResponse = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    system: TRAINING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: evalMessage }],
  });

  const evalText = evalResponse.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");

  const cleanText = evalText.replace(/```json|```/g, "").trim();
  const evaluation = JSON.parse(cleanText);

  // 4. Build result
  const result = {
    agent: agentId,
    prompt,
    timestamp: new Date().toISOString(),
    output: agentOutput,
    evaluation,
    tokens: {
      agent: agentResponse.usage,
      evaluator: evalResponse.usage,
    },
  };

  // 5. Save
  const filepath = saveResult(agentId, result);
  console.log(`    Saved: ${filepath}\n`);

  // 6. Print summary
  const e = evaluation;
  console.log(`  ┌─────────────────────────────┐`);
  console.log(`  │  Overall: ${e.overall}/5 ${scoreBar(e.overall)}  │`);
  console.log(`  ├─────────────────────────────┤`);
  for (const c of EVAL_CRITERIA) {
    const score = e.scores[c] || 0;
    const label = c.replace("_", " ").padEnd(15);
    console.log(`  │  ${label} ${scoreBar(score)} ${score}/5  │`);
  }
  console.log(`  └─────────────────────────────┘\n`);

  console.log(`  Summary: ${e.summary}\n`);

  if (e.suggested_skill_changes?.length) {
    console.log(`  Suggested changes:`);
    for (const change of e.suggested_skill_changes) {
      console.log(`    → [${change.section}] ${change.change}`);
    }
  }

  return result;
}

function scoreBar(score) {
  return "█".repeat(score) + "░".repeat(5 - score);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    agent: { type: "string", short: "a" },
    prompt: { type: "string", short: "p" },
  },
});

if (!values.agent || !values.prompt) {
  console.log("Usage: node scripts/evaluate.js --agent <agent-id> --prompt <prompt>");
  console.log(`\nAvailable agents: ${AGENTS.join(", ")}`);
  process.exit(1);
}

if (!AGENTS.includes(values.agent)) {
  console.error(`Unknown agent: ${values.agent}`);
  console.log(`Available agents: ${AGENTS.join(", ")}`);
  process.exit(1);
}

evaluate(values.agent, values.prompt).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
