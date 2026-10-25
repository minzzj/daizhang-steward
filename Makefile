# 代掌 Steward — cross-platform task aliases.
# Windows 10/11 users: prefer `npm run <script>`; `make` is optional and mainly
# kept for Linux/macOS parity.

.PHONY: check secrets build test test-prompts demo lint evidence sync

check:
	node scripts/check-scaffold.mjs

secrets:
	node scripts/check-secrets.mjs

build:
	npm run build

test:
	npm test

test-prompts:
	npm run test:prompts

demo:
	npm run demo

lint:
	npm run lint

evidence:
	npm run evidence

sync:
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-delivery.ps1
