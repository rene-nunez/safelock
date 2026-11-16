.DEFAULT_GOAL := help

.PHONY: help firmware monitor simulator test lint frontend typecheck mqtt-restart

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

firmware: ## Build the ESP32 firmware
	pio run -d firmware

monitor: ## Open the serial monitor
	pio device monitor -d firmware

simulator: ## Run the fake ESP32 (2 devices)
	python backend/scripts/simulator.py

test: ## Run the backend tests
	pytest backend/tests -q

lint: ## Lint and type-check the backend
	ruff check backend
	mypy backend

frontend: ## Start the frontend dev server
	npm run dev --prefix frontend

typecheck: ## Type-check the frontend
	npm run typecheck --prefix frontend

mqtt-restart: ## Restart the local Mosquitto broker
	sudo systemctl restart mosquitto
