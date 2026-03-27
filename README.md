# Norman

A virtual design team powered by specialized AI agents — named after [Don Norman](https://en.wikipedia.org/wiki/Don_Norman), pioneer of human-centered design.

Give Norman a design brief. Walk away. Come back to a finished design document.

## How It Works

```bash
node scripts/build.js "Design a settings page for a travel app"
```

Norman manages a team of three specialists. It assigns work, reviews their output, sends it back for revision if it's not good enough, and assembles a final deliverable:

```
┌──────────┐     ┌──────────────┐     ┌─────────────┐
│ Research  │────▶│ Design       │────▶│ Production  │
│ Agent     │  ↕  │ Partner      │  ↕  │ Design      │
└──────────┘     └──────────────┘     └─────────────┘
       ↕                ↕                    ↕
   ┌────────────────────────────────────────────┐
   │           Norman (Director)                │
   │   Reviews · Revises · Assembles            │
   └────────────────────────────────────────────┘
```

Each arrow marked ↕ is a quality gate. Norman reviews the agent's output against the original brief and either approves it or sends it back with specific feedback (up to 2 revision rounds per stage).

The output is a markdown design document with research insights, the chosen concept direction, and a full production spec (type system, color tokens, spacing scale, component specs).

## Quick Start

```bash
# Clone and install
git clone https://github.com/yourusername/norman.git
cd norman
npm install

# Set your API key
cp .env.example .env
# Edit .env with your Anthropic API key

# Run a build
node scripts/build.js "Design an AI-powered trip planning interface"
```

Output lands in `./output/` as a dated markdown file.

## Trigger from GitHub (run from anywhere)

The repo includes a GitHub Action for remote builds:

1. Add your `ANTHROPIC_API_KEY` as a repository secret
2. Go to Actions → "Norman Build" → Run workflow
3. Enter your brief
4. Norman runs, commits the deliverable to `output/`, and uploads it as an artifact

## The Team

| Agent | Role | What It Does |
|-------|------|-------------|
| **Research Agent** | Intelligence | Scans competitors, identifies UX patterns, finds gaps |
| **Design Partner** | Ideation | Generates 3 divergent concept directions with tradeoffs |
| **Production Design** | Craft | Builds full spec — type, color, spacing, components, layout |
| **Norman (Director)** | Quality | Reviews each stage, requests revisions, assembles deliverable |

## Training the Team

Norman's agents improve over time through a training loop:

```bash
# Evaluate all agents against test prompts
node scripts/train.js

# Evaluate a specific agent
node scripts/train.js --agent design-partner

# Evaluate a single prompt
node scripts/evaluate.js --agent research-agent --prompt "How does Airbnb handle trip planning?"
```

The weekly GitHub Action (`train.yml`) runs evaluations automatically and opens issues when agent scores drop below 3.0/5.

## Customizing Agents

Each agent is defined by a `SKILL.md` file:

```
skills/
├── design-partner/SKILL.md      # Creative exploration
├── research-agent/SKILL.md      # Competitive intelligence
├── production-design/SKILL.md   # Design craft & specs
└── training-agent/SKILL.md      # Meta-agent for improvement
```

Edit a SKILL.md to change an agent's behavior, then run `node scripts/train.js` to verify the change improved quality.

Skills can also be installed directly in Claude as `.skill` files — see Releases.

## Project Structure

```
norman/
├── skills/                  # Agent skill definitions (the real IP)
├── scripts/
│   ├── build.js             # Autonomous design pipeline
│   ├── evaluate.js          # Single agent evaluation
│   └── train.js             # Full training loop
├── src/
│   ├── norman-pipeline.jsx  # Interactive pipeline (Claude artifact)
│   └── training-console.jsx # Training dashboard (Claude artifact)
├── .github/workflows/
│   ├── build.yml            # Remote build trigger
│   └── train.yml            # Weekly automated training
├── output/                  # Generated deliverables
└── training-history/        # Evaluation records
```

## License

MIT
