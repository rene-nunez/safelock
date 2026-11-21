.DEFAULT_GOAL := help

VENV := backend/.venv
PYTHON := $(if $(wildcard $(VENV)/bin/python),$(VENV)/bin/python,python3)
PYTEST := $(if $(wildcard $(VENV)/bin/pytest),$(VENV)/bin/pytest,pytest)
RUFF := $(if $(wildcard $(VENV)/bin/ruff),$(VENV)/bin/ruff,ruff)
MYPY := $(if $(wildcard $(VENV)/bin/mypy),$(VENV)/bin/mypy,mypy)

.PHONY: help venv backend create-user seed-demo seed-demo-reset provision firmware test-firmware monitor simulator test lint format frontend typecheck mqtt-restart

help: ## Help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

venv: ## Create backend venv
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -e 'backend[dev]'

backend: ## Run backend API
	$(PYTHON) -m uvicorn app.main:app --reload --app-dir backend

create-user: ## Create an account (admin by default)
	PYTHONPATH=backend $(PYTHON) -m app.cli create-user $(CLI_ARGS)

seed-demo: ## Seed demo data (development databases only)
	PYTHONPATH=backend $(PYTHON) -m app.cli seed-demo

seed-demo-reset: ## Remove demo data
	PYTHONPATH=backend $(PYTHON) -m app.cli seed-demo --reset

provision: ## Provision a device over serial (PORT=/dev/ttyUSB0)
	@test -n "$(PORT)" || (echo "Usage: make provision PORT=/dev/ttyUSB0"; exit 1)
	$(PYTHON) backend/scripts/provision.py --port $(PORT)

firmware: ## Build firmware
	pio run -d firmware

test-firmware: ## Test firmware validators (host build)
	cd firmware && pio test -c native.ini

monitor: ## Serial monitor
	pio device monitor -d firmware -b 115200

simulator: ## Run simulator
	$(PYTHON) backend/scripts/simulator.py $(SIM_ARGS)

test: ## Backend tests
	$(PYTEST) backend/tests -q

lint: ## Lint backend
	$(RUFF) check backend
	$(MYPY) --config-file backend/pyproject.toml backend

format: ## Format backend
	$(RUFF) format backend

frontend: ## Frontend dev
	npm run dev --prefix frontend

typecheck: ## Typecheck frontend
	npm run typecheck --prefix frontend

mqtt-restart: ## Restart Mosquitto
	sudo systemctl restart mosquitto
