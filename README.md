# Smugit — Frictionless Git for Teams

<div align="center">
  <h3>🎯 Git, but smoooth.</h3>
  <p>A SaaS-powered developer companion that removes the pain from conflicts, rebases, and messy commit histories — making version control seamless.</p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/smugit/smugit)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

</div>

## 📦 Packages

This repository is a monorepo containing the following packages:

| Package | Description | Version | Status |
|---------|-------------|---------|--------|
| [`@smugit/cli`](./packages/cli) | Command-line interface for frictionless Git workflows | `0.1.0` | ✅ MVP Ready |
| [`@smugit/web`](./packages/web) | Next.js web application for conflict visualization | `0.1.0` | 🚧 In Development |
| [`@smugit/api`](./packages/api) | FastAPI backend for team features and AI analysis | `0.1.0` | 🚧 In Development |
| [`@smugit/shared`](./packages/shared) | Shared utilities and types across packages | `0.1.0` | ✅ Ready |

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/smugit/smugit.git
cd smugit

# Install dependencies
npm install

# Build all packages
npm run build
```

### CLI Usage

```bash
# Install CLI globally (after build)
npm install -g ./packages/cli

# Or run directly
npx smugit

# Check repository status with insights
smugit status

# Analyze and auto-fix conflicts
smugit analyze
smugit fix --auto

# Generate intelligent commit messages
smugit commit --interactive
```

## 💡 Core Features

### 🔧 Intelligent Conflict Resolution
- **Auto-resolve** trivial whitespace and import conflicts
- **AI-assisted** suggestions for complex merge scenarios
- **Plain English** explanations of what conflicts mean
- **Safety-first** approach with checkpoint branches

### 📝 Smart Commit Messages
- **Conventional Commits** generated automatically from changes
- **Semantic analysis** of diff content for accurate descriptions
- **Branch-aware** scoping from feature branch names
- **Confidence scoring** for commit message quality

### 🎯 Enhanced Git Workflows
- **Visual conflict analysis** with complexity indicators
- **Interactive resolution** with guided choices
- **Dry-run mode** for safe experimentation
- **Team-ready** with audit logs and compliance features

### 🌐 Web Experience *(Coming Soon)*
- **Conflict Explorer**: Force-graph visualization of conflicted files
- **Rebase Planner**: Visual commit history with safe rebase suggestions
- **Team Dashboard**: KPIs for merge velocity and conflict patterns

## 🏗️ Architecture

```
smugit/
├── packages/
│   ├── cli/          # Command-line interface
│   │   ├── src/
│   │   │   ├── commands/    # CLI commands (analyze, fix, commit, status)
│   │   │   ├── git/         # Git analysis and resolution engine
│   │   │   └── cli.ts       # Main CLI entry point
│   │   └── package.json
│   │
│   ├── web/          # Next.js web application
│   │   ├── src/
│   │   │   ├── components/  # React components
│   │   │   ├── pages/       # Next.js pages
│   │   │   └── lib/         # Utilities and hooks
│   │   └── package.json
│   │
│   ├── api/          # FastAPI backend
│   │   ├── src/
│   │   │   ├── routes/      # API endpoints
│   │   │   ├── models/      # Database models
│   │   │   └── services/    # Business logic
│   │   └── package.json
│   │
│   └── shared/       # Shared utilities and types
│       ├── src/
│       │   ├── types.ts     # TypeScript type definitions
│       │   └── utils.ts     # Common utilities
│       └── package.json
│
├── package.json      # Root package.json with workspaces
├── tsconfig.json     # TypeScript configuration
└── README.md
```

## 🛠️ Development

### Prerequisites
- Node.js 20+
- npm 9+
- Git 2.30+

### Setup
```bash
# Install dependencies
npm install

# Start development mode
npm run dev

# Run tests
npm run test

# Type checking
npm run typecheck

# Linting
npm run lint
```

### Working with Packages

```bash
# Work on CLI package
cd packages/cli
npm run dev

# Work on web package
cd packages/web
npm run dev

# Work on API package
cd packages/api
npm run dev
```

## 📋 CLI Commands Reference

### `smugit analyze`
Analyze repository for conflicts and issues
```bash
smugit analyze              # Full analysis
smugit analyze --conflicts  # Conflicts only
smugit analyze --verbose    # Detailed output
```

### `smugit fix`
Auto-resolve or interactively fix merge conflicts
```bash
smugit fix --auto           # Auto-resolve safe conflicts
smugit fix --interactive    # Interactive resolution
smugit fix --dry-run        # Preview changes only
```

### `smugit commit`
Generate and create intelligent commit messages
```bash
smugit commit                   # Interactive commit
smugit commit --auto           # Auto-generate and commit
smugit commit -m "message"     # Custom message
smugit commit --dry-run        # Preview only
```

### `smugit status`
Enhanced repository status with actionable insights
```bash
smugit status               # Full status
smugit status --verbose     # Detailed information
smugit status --conflicts-only  # Conflicts only
```

## 🎯 Roadmap

| Phase | Deliverables | ETA | Status |
|-------|-------------|-----|--------|
| **MVP** | CLI (explain/fix trivial), commit suggest, web demo | 1–2m | ✅ **Complete** |
| **v0.2** | AST merges, rebase planner, SaaS API integration | 3–4m | 🚧 In Progress |
| **v0.3** | AI patch assistant, team dashboards, policies | 5–6m | 📋 Planned |
| **v1.0** | Enterprise-grade, PR bot, metrics & compliance | 9–12m | 📋 Planned |

## 🔒 Safety & Trust

- **Checkpoint branches** created before any modifications
- **Dry-run mode** by default with explicit user confirmation
- **Secret redaction** before external API calls
- **Configurable** auto-apply thresholds based on change complexity

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm run test`)
5. Commit with conventional commits (`git commit -m "feat: add amazing feature"`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [simple-git](https://github.com/steveukx/git-js) for Git integration
- [Commander.js](https://github.com/tj/commander.js) for CLI framework
- [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) for interactive prompts
- [Chalk](https://github.com/chalk/chalk) for terminal styling

---

<div align="center">
  <strong>Made with ❤️ by the Smugit Team</strong><br>
  <em>Git, but smoooth.</em>
</div>