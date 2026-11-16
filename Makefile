.DEFAULT_GOAL := help

.PHONY: help firmware monitor simulator test lint frontend typecheck mqtt-restart

help: ## Help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

firmware: ## Build firmware
	pio run -d firmware

monitor: ## Serial monitor
	pio device monitor -d firmware

simulator: ## Run simulator
	python backend/scripts/simulator.py

test: ## Backend tests
	pytest backend/tests -q

lint: ## Lint backend
	ruff check backend
	mypy backend

frontend: ## Frontend dev
	npm run dev --prefix frontend

typecheck: ## Typecheck frontend
	npm run typecheck --prefix frontend

mqtt-restart: ## Restart Mosquitto
	sudo systemctl restart mosquitto
