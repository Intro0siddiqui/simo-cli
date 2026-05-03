# Simo CLI: Future Roadmap & Deferred Tasks

This document tracks planned architectural improvements and documentation tasks deferred to prioritize current feature development.

## 1. Documentation & Skill Integration
- [x] **Merge Skills**: Integrated technical content into the formal `.agents/skills/simo-automator/SKILL.md` template.
- [ ] **Resource Organization**: Move `observer.py` and `server.py` references into the `scripts/` directory structure within the Gemini skill folder.
- [x] **User Guide Expansion**: Created `troubleshooting.md` for common CDP connection issues.

## 2. Architectural Evolution (Go Migration)
- [ ] **Source Recovery**: Re-implement the Go `cmd/` and `client/` structures (removed in v1.9.9 cleanup) to support a single-binary distribution.
- [ ] **Relay Port**: Rewrite the Python `server.py` in Go to eliminate the Python dependency entirely.
- [ ] **Cross-Platform Helpers**: Replace `.sh` scripts (`start-observer.sh`, `install.sh`) with Go-native commands (e.g., `simo serve`, `simo init`).

## 3. Stability & Intelligence
- [ ] **Multi-Tab Support**: Improve the Go binary's ability to handle concurrent tab monitoring.
- [ ] **Visual Verification Loop**: Implement an automatic `shot` + AI-analysis step after every `click` to ensure the interaction had the intended effect.
- [ ] **Detection Evasion**: Rotate "Hardware-Pulse" delay signatures to prevent pattern-matching by anti-bot services.

---
*Last Updated: 2026-05-22 by Agent Jules*
