# 代掌 Steward — cross-platform task aliases.
# Windows 10/11 users: use `pnpm <script>` (npm scripts) or scripts/*.ps1 instead;
# `make` is optional and mainly kept for Linux/macOS CI parity.

.PHONY: check secrets dev demo test lint sync

check:
	node scripts/check-scaffold.mjs

secrets:
	node scripts/check-secrets.mjs

dev:
	pnpm dev

demo:
	pnpm demo

test:
	pnpm test

lint:
	pnpm lint

sync:
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-delivery.ps1
