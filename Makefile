# ============================================================
# Solar Finance Core — Makefile
# ============================================================
# One-command operations for Leanid on M4 Pro.
#
# First-time setup:
#   make setup         # copies .env, builds images, starts stack
#   make pull-model    # pulls Qwen 2.5 72B Q4_K_M (~43 GB, 40–60 min)
#   make health        # verifies all systems
#
# Daily operations:
#   make up            # start everything
#   make down          # stop everything (data preserved)
#   make logs          # tail all logs
#   make logs-api      # tail API logs only
#   make status        # show container status
#
# Destructive (ask twice before running):
#   make nuke          # delete all volumes — wipes DB and downloaded model
# ============================================================

.DEFAULT_GOAL := help

SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: help
help:
	@echo "Solar Finance Core — available commands:"
	@echo ""
	@echo "  First run:"
	@echo "    make setup        — prepare .env, build images, start stack"
	@echo "    make pull-model   — download Qwen 2.5 72B Q4_K_M (~43 GB)"
	@echo "    make health       — run full health check (Task 1 gate)"
	@echo ""
	@echo "  Daily:"
	@echo "    make up           — start all services"
	@echo "    make down         — stop all services"
	@echo "    make restart      — restart all services"
	@echo "    make status       — show container status"
	@echo "    make logs         — tail all logs"
	@echo "    make logs-api     — tail API logs"
	@echo "    make logs-llm     — tail Ollama logs"
	@echo ""
	@echo "  Maintenance:"
	@echo "    make rebuild      — rebuild API image (after code changes)"
	@echo "    make shell-api    — shell into API container"
	@echo "    make shell-db     — psql into database"
	@echo ""
	@echo "  Destructive:"
	@echo "    make nuke         — delete ALL volumes (DB + model)"

.PHONY: setup
setup:
	@echo "→ Preparing environment..."
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "  .env created from .env.example"; \
		echo "  ⚠  Review and edit POSTGRES_PASSWORD before production use."; \
	else \
		echo "  .env already exists, leaving it alone"; \
	fi
	@echo "→ Making scripts executable..."
	@chmod +x scripts/*.sh
	@echo "→ Building API image..."
	@$(COMPOSE) build api
	@echo "→ Starting stack..."
	@$(COMPOSE) up -d
	@echo ""
	@echo "✓ Setup complete."
	@echo ""
	@echo "Next: 'make pull-model' to download Qwen (first time only, ~40-60 min)"
	@echo "Then: 'make health' to verify everything."

.PHONY: up
up:
	@$(COMPOSE) up -d
	@echo "✓ Stack up. Run 'make status' to see details."

.PHONY: down
down:
	@$(COMPOSE) down
	@echo "✓ Stack stopped. Data preserved. Run 'make up' to restart."

.PHONY: restart
restart: down up

.PHONY: status
status:
	@$(COMPOSE) ps

.PHONY: logs
logs:
	@$(COMPOSE) logs -f --tail=100

.PHONY: logs-api
logs-api:
	@$(COMPOSE) logs -f --tail=200 api

.PHONY: logs-llm
logs-llm:
	@$(COMPOSE) logs -f --tail=200 ollama

.PHONY: logs-db
logs-db:
	@$(COMPOSE) logs -f --tail=200 postgres

.PHONY: rebuild
rebuild:
	@$(COMPOSE) build api
	@$(COMPOSE) up -d api
	@echo "✓ API rebuilt and restarted."

.PHONY: pull-model
pull-model:
	@./scripts/download_qwen.sh

.PHONY: health
health:
	@./scripts/health_check.sh

.PHONY: shell-api
shell-api:
	@docker exec -it solar_api /bin/bash

.PHONY: shell-db
shell-db:
	@set -a; source .env 2>/dev/null; set +a; \
	docker exec -it solar_postgres psql -U $${POSTGRES_USER:-solar} -d $${POSTGRES_DB:-solar_finance}

.PHONY: nuke
nuke:
	@echo "⚠  This will DELETE all data:"
	@echo "   - PostgreSQL database (all tables, all rows)"
	@echo "   - Redis cache"
	@echo "   - Downloaded Qwen model (~43 GB — would need re-download)"
	@echo ""
	@read -p "Type 'nuke solar' to confirm: " confirm; \
	if [ "$$confirm" = "nuke solar" ]; then \
		$(COMPOSE) down -v; \
		echo "✓ All volumes deleted."; \
	else \
		echo "✗ Aborted."; \
	fi
