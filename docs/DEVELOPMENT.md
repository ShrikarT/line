# Developer Guide & Local Workflow

## Getting Started

### Prerequisites
- Node.js `>= 22.0.0` (with `--experimental-strip-types` support)
- npm `>= 10.0.0`
- Compact compiler `0.34.0` (supported on Linux, macOS, and Windows via WSL)

---

## Installation

```bash
git clone https://github.com/ShrikarT/line.git
cd line
npm ci
```

---

## Common Development Commands

### 1. Contract Compilation
```bash
# Fast compilation (generates ZKIR, contract types, and manifests without proving keys)
npm run compact:compile

# Release compilation (generates complete proving and verifying keys)
npm run compact:compile:release

# Verify zero drift in generated bindings
git diff --exit-code contracts/managed/
```

### 2. Testing
```bash
# Run complete test suite (Compact simulator, replica engine, demo snapshots, model, leakage, runtime, vault, MCP)
npm test

# Run only Compact simulator tests and cross-language vectors
npm run compact:test

# Run only leakage and privacy boundary verification tests
npm run test:leakage

# Run only MCP integration tests
npm run mcp:test
```

### 3. Running the Frontend Application
```bash
# Start Vite development server
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

Routes:
- `/`: Product Landing Page
- `/issuer`: Issuer Console
- `/merchant`: Merchant Console (Merchant A & B)
- `/agent`: Agent Console
- `/explorer`: Public Explorer
- `/lab`: Attack Lab & Security Invariant Demonstrator
- `/circuits`: Compact Circuit Inspector
- `/roadmap`: Capability Roadmap

### 4. Running the MCP Server
```bash
# Run local development MCP server
npm run mcp:dev
```

### 5. Typecheck & Build
```bash
npm run typecheck
npm run build
```
