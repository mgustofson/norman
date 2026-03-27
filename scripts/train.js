#!/usr/bin/env node

/**
 * Norman — Full Training Loop
 *
 * Runs all agents (or a specific one) through their test prompts,
 * evaluates each, and produces a summary report.
 *
 * Usage:
 *   node scripts/train.js                    # All agents
 *   node scripts/train.js --agent research-agent  # Single agent
 *   node scripts/train.js --ci               # CI mode (exit 1 if any score < 3)
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Test prompts per agent
// ---------------------------------------------------------------------------

const TEST_PROMPTS = {
  "design-partner": [
    "I'm designing a travel booking app and the checkout flow feels too transactional. Help me think about how to make it feel more like planning an adventure.",
    "We have a dashboard that shows 15 different metrics. Users say they feel overwhelmed. What are some directions we could take?",
    "I'm stuck on how to handle empty states in a social product where new users have no content yet.",
  ],
  "research-agent": [
    "How are Booking.com, Airbnb, and Expedia handling AI-powered trip planning right now? I want specifics on their UX patterns.",
    "What are the dominant onboarding patterns in fintech apps targeting small businesses?",
    "Research how the top 5 design tools handle their plugin/extension marketplaces.",
  ],
  "production-design": [
    "I have a card component with a title, subtitle, thumbnail, and action button. The spacing feels off and the hierarchy is unclear. Help me tighten it up.",
    "Review this type system: H1 is 36px, H2 is 24px, H3 is 18px, body is 16px, caption is 12px. All using Inter. What would you change?",
    "I need a color system for a health-tech product. Clean and trustworthy but not cold. Build me the semantic tokens.",
  ],
  "training-agent": [
    "The Design Partner gave me very generic brainstorming output — it felt like it could apply to any product. How do we fix that?",
    "I want the Research Agent to be better at citing specific sources. What should we change in its skill file?",
    "Propose a new agent for the team that handles design systems and component documentation.",
  ],
};

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
  return readFileSync(skillPath, "utf-8");
}

function extractSystemPrompt(skillContent) {
  return skillContent.replace(/^---[\s\S]*?---\n*/m, "").trim();
}

function scoreBar(score) {
  return "█".repeat(score) + "░".repeat(5 - score);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

async function evaluateOne(client, agentId, prompt, skillContent) {
  const systemPrompt = extractSystemPrompt(skillContent);

  // Run agent
  const agentResponse = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });

  const agentOutput = agentResponse.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");

  // Small delay to avoid rate limits
  await delay(1000);

  // Evaluate
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

  const evaluation = JSON.parse(evalText.replace(/```json|```/g, "").trim());

  return {
    agent: agentId,
    prompt,
    output: agentOutput,
    evaluation,
    tokens: {
      agent: agentResponse.usage,
      evaluator: evalResponse.usage,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function train(targetAgent, ciMode) {
  const client = new Anthropic();
  const agents = targetAgent ? [targetAgent] : Object.keys(TEST_PROMPTS);
  const runTimestamp = new Date().toISOString();
  const allResults = [];
  const summary = {};

  console.log(`\n◆ Norman — Training Run`);
  console.log(`  ${new Date().toLocaleString()}`);
  console.log(`  Agents: ${agents.join(", ")}\n`);

  for (const agentId of agents) {
    const prompts = TEST_PROMPTS[agentId];
    const skillContent = loadSkill(agentId);
    const agentResults = [];

    console.log(`\n━━━ ${agentId} ━━━`);

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      console.log(`  Prompt ${i + 1}/${prompts.length}: "${prompt.slice(0, 60)}..."`);

      try {
        const result = await evaluateOne(client, agentId, prompt, skillContent);
        agentResults.push(result);
        allResults.push(result);

        const e = result.evaluation;
        console.log(`    Score: ${e.overall}/5 ${scoreBar(e.overall)}`);
        console.log(`    ${e.summary}\n`);

        // Rate limit buffer
        await delay(2000);
      } catch (err) {
        console.error(`    Error: ${err.message}\n`);
      }
    }

    // Agent summary
    if (agentResults.length > 0) {
      const avgOverall =
        agentResults.reduce((s, r) => s + r.evaluation.overall, 0) /
        agentResults.length;

      const avgScores = {};
      for (const criterion of ["specificity", "role_fidelity", "depth", "voice", "actionability"]) {
        avgScores[criterion] =
          agentResults.reduce((s, r) => s + (r.evaluation.scores[criterion] || 0), 0) /
          agentResults.length;
      }

      // Collect all unique suggestions
      const suggestions = agentResults
        .flatMap((r) => r.evaluation.suggested_skill_changes || [])
        .filter(
          (s, i, arr) =>
            arr.findIndex((x) => x.section === s.section && x.change === s.change) === i
        );

      summary[agentId] = {
        avgOverall: Math.round(avgOverall * 10) / 10,
        avgScores,
        suggestions,
        evalCount: agentResults.length,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Save full run
  // ---------------------------------------------------------------------------

  const historyDir = join(ROOT, "training-history");
  mkdirSync(historyDir, { recursive: true });

  const runId = runTimestamp.replace(/[:.]/g, "-");
  const runFile = join(historyDir, `run_${runId}.json`);

  const runData = {
    timestamp: runTimestamp,
    summary,
    results: allResults,
  };

  writeFileSync(runFile, JSON.stringify(runData, null, 2));

  // ---------------------------------------------------------------------------
  // Print summary
  // ---------------------------------------------------------------------------

  console.log(`\n\n◆ Training Summary`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  let hasFailures = false;

  for (const [agentId, data] of Object.entries(summary)) {
    const status = data.avgOverall >= 4 ? "✅" : data.avgOverall >= 3 ? "⚠️" : "❌";
    if (data.avgOverall < 3) hasFailures = true;

    console.log(`${status} ${agentId}: ${data.avgOverall}/5`);

    for (const [criterion, score] of Object.entries(data.avgScores)) {
      const label = criterion.replace("_", " ").padEnd(15);
      console.log(`   ${label} ${score.toFixed(1)}`);
    }

    if (data.suggestions.length > 0) {
      console.log(`   Suggestions:`);
      for (const s of data.suggestions.slice(0, 3)) {
        console.log(`     → [${s.section}] ${s.change}`);
      }
    }
    console.log();
  }

  console.log(`Results saved: ${runFile}\n`);

  // CI mode: fail if any agent below threshold
  if (ciMode && hasFailures) {
    console.error("❌ Training failed: one or more agents scored below 3.0");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    agent: { type: "string", short: "a" },
    ci: { type: "boolean", default: false },
  },
});

if (values.agent && !TEST_PROMPTS[values.agent]) {
  console.error(`Unknown agent: ${values.agent}`);
  console.log(`Available: ${Object.keys(TEST_PROMPTS).join(", ")}`);
  process.exit(1);
}

train(values.agent || null, values.ci).catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
