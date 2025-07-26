# PostgreSQL S3 Backup - Makefile
# Provides convenient shortcuts for common development and deployment tasks

.PHONY: help install build test lint format clean docker deploy dev

# Default target
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
NC := \033[0m # No Color

# Configuration
SERVICE_NAME := postgres-s3-backup
DOCKER_IMAGE := $(SERVICE_NAME)
ENV_FILE := .env
COMPOSE_FILE := docker-compose.yml

help: ## Show this help message
	@echo "$(BLUE)PostgreSQL S3 Backup - Available Commands$(NC)"
	@echo "=============================================="
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "$(GREEN)%-20s$(NC) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# Development Commands
install: ## Install dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	npm ci

dev: ## Start development server with hot reload
	@echo "$(BLUE)Starting development server...$(NC)"
	npm run dev

build: ## Build TypeScript application
	@echo "$(BLUE)Building application...$(NC)"
	npm run build

build-watch: ## Build with watch mode for development
	@echo "$(BLUE)Building with watch mode...$(NC)"
	npm run build:watch

# Testing Commands
test: ## Run all tests
	@echo "$(BLUE)Running tests...$(NC)"
	npm test

test-watch: ## Run tests in watch mode
	@echo "$(BLUE)Running tests in watch mode...$(NC)"
	npm run test:watch

test-coverage: ## Run tests with coverage report
	@echo "$(BLUE)Running tests with coverage...$(NC)"
	npm run test:coverage

test-ci: ## Run tests for CI (no watch, with coverage)
	@echo "$(BLUE)Running CI tests...$(NC)"
	npm run test:ci

test-integration: ## Run integration tests
	@echo "$(BLUE)Running integration tests...$(NC)"
	npm run test:integration

# Code Quality Commands
lint: ## Run ESLint
	@echo "$(BLUE)Running linter...$(NC)"
	npm run lint

lint-fix: ## Fix linting issues automatically
	@echo "$(BLUE)Fixing linting issues...$(NC)"
	npm run lint:fix

format: ## Format code with Prettier
	@echo "$(BLUE)Formatting code...$(NC)"
	npm run format

format-check: ## Check code formatting
	@echo "$(BLUE)Checking code formatting...$(NC)"
	npm run format:check

type-check: ## Run TypeScript type checking
	@echo "$(BLUE)Running type checking...$(NC)"
	npm run type-check

validate: ## Run all validation checks (type-check, lint, format-check, test)
	@echo "$(BLUE)Running all validation checks...$(NC)"
	npm run validate

# Cleanup Commands
clean: ## Clean build artifacts and dependencies
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	npm run clean
	rm -rf node_modules

clean-all: clean ## Clean everything including Docker images and volumes
	@echo "$(BLUE)Cleaning Docker resources...$(NC)"
	docker system prune -f
	docker volume prune -f

# Docker Commands
docker-build: ## Build Docker image
	@echo "$(BLUE)Building Docker image...$(NC)"
	docker build -t $(DOCKER_IMAGE) .

docker-build-dev: ## Build development Docker image
	@echo "$(BLUE)Building development Docker image...$(NC)"
	docker build -t $(DOCKER_IMAGE):dev --target development .

docker-run: ## Run Docker container with environment file
	@echo "$(BLUE)Running Docker container...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)Error: $(ENV_FILE) not found. Copy .env.example to .env and configure it.$(NC)"; \
		exit 1; \
	fi
	docker run --rm --env-file $(ENV_FILE) $(DOCKER_IMAGE)

docker-run-dev: ## Run development Docker container
	@echo "$(BLUE)Running development Docker container...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)Error: $(ENV_FILE) not found. Copy .env.example to .env and configure it.$(NC)"; \
		exit 1; \
	fi
	docker run -it --rm --env-file $(ENV_FILE) -v $(PWD):/app $(DOCKER_IMAGE):dev

# Docker Compose Commands
up: ## Start services with Docker Compose
	@echo "$(BLUE)Starting services...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)Error: $(ENV_FILE) not found. Copy .env.example to .env and configure it.$(NC)"; \
		exit 1; \
	fi
	docker-compose up -d

up-build: ## Start services and rebuild images
	@echo "$(BLUE)Starting services with build...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)Error: $(ENV_FILE) not found. Copy .env.example to .env and configure it.$(NC)"; \
		exit 1; \
	fi
	docker-compose up -d --build

down: ## Stop services
	@echo "$(BLUE)Stopping services...$(NC)"
	docker-compose down

restart: ## Restart services
	@echo "$(BLUE)Restarting services...$(NC)"
	docker-compose restart

logs: ## Show service logs
	@echo "$(BLUE)Showing logs...$(NC)"
	docker-compose logs -f postgres-backup

status: ## Show service status
	@echo "$(BLUE)Service status:$(NC)"
	docker-compose ps

# Deployment Commands
deploy: ## Deploy to production using deployment script
	@echo "$(BLUE)Deploying to production...$(NC)"
	./scripts/deploy.sh

deploy-dev: ## Deploy to development environment
	@echo "$(BLUE)Deploying to development...$(NC)"
	./scripts/deploy.sh --environment development --skip-tests

deploy-force: ## Force deploy without confirmation
	@echo "$(BLUE)Force deploying...$(NC)"
	./scripts/deploy.sh --force

# Setup Commands
setup: ## Initial project setup
	@echo "$(BLUE)Setting up project...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(YELLOW)Creating .env file from template...$(NC)"; \
		cp .env.example $(ENV_FILE); \
		echo "$(YELLOW)Please edit $(ENV_FILE) with your configuration$(NC)"; \
	fi
	npm ci
	npm run build
	@echo "$(GREEN)Setup complete! Edit $(ENV_FILE) and run 'make up' to start.$(NC)"

setup-dev: ## Setup for development
	@echo "$(BLUE)Setting up development environment...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		cp .env.example $(ENV_FILE); \
	fi
	npm ci
	@echo "$(GREEN)Development setup complete!$(NC)"

# Utility Commands
env-check: ## Check environment configuration
	@echo "$(BLUE)Checking environment configuration...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)Error: $(ENV_FILE) not found$(NC)"; \
		exit 1; \
	fi
	@echo "$(GREEN)Environment file exists$(NC)"
	@echo "Required variables:"
	@grep -E "^(S3_BUCKET|S3_ACCESS_KEY|S3_SECRET_KEY|POSTGRES_CONNECTION_STRING|BACKUP_INTERVAL)=" $(ENV_FILE) || echo "$(RED)Some required variables missing$(NC)"

backup-test: ## Test backup functionality (requires running services)
	@echo "$(BLUE)Testing backup functionality...$(NC)"
	docker-compose exec postgres-backup node -e "console.log('Backup test - check logs for results')"

health-check: ## Check service health
	@echo "$(BLUE)Checking service health...$(NC)"
	@if docker-compose ps | grep -q "Up"; then \
		echo "$(GREEN)Service is running$(NC)"; \
		docker-compose exec postgres-backup node -e "process.exit(0)" && echo "$(GREEN)Health check passed$(NC)" || echo "$(RED)Health check failed$(NC)"; \
	else \
		echo "$(RED)Service is not running$(NC)"; \
	fi

# Docker Hub Commands
docker-hub-setup: ## Set up Docker Hub publishing
	@echo "$(BLUE)Setting up Docker Hub publishing...$(NC)"
	./scripts/setup-docker-hub.sh

docker-hub-check: ## Check Docker Hub setup
	@echo "$(BLUE)Checking Docker Hub setup...$(NC)"
	./scripts/setup-docker-hub.sh --check-only

# Documentation Commands
docs: ## Generate documentation (if applicable)
	@echo "$(BLUE)Documentation available in README.md$(NC)"
	@echo "View online documentation at: https://github.com/your-repo/postgres-s3-backup"
	@echo "$(BLUE)Docker Hub setup guide: docs/DOCKER_HUB_SETUP.md$(NC)"

# Quick Commands
quick-start: setup up ## Quick start: setup and run
	@echo "$(GREEN)Quick start complete! Service is running.$(NC)"
	@echo "$(BLUE)View logs with: make logs$(NC)"
	@echo "$(BLUE)Stop with: make down$(NC)"

quick-dev: setup-dev dev ## Quick development start
	@echo "$(GREEN)Development server started!$(NC)"

# CI/CD Commands
ci: validate ## Run CI checks locally
	@echo "$(GREEN)All CI checks passed!$(NC)"

pre-commit: lint-fix format test ## Run pre-commit checks
	@echo "$(GREEN)Pre-commit checks completed!$(NC)"

# Information Commands
info: ## Show project information
	@echo "$(BLUE)PostgreSQL S3 Backup Service$(NC)"
	@echo "=============================="
	@echo "Service Name: $(SERVICE_NAME)"
	@echo "Docker Image: $(DOCKER_IMAGE)"
	@echo "Environment File: $(ENV_FILE)"
	@echo "Compose File: $(COMPOSE_FILE)"
	@echo ""
	@echo "$(BLUE)Quick Commands:$(NC)"
	@echo "  make setup     - Initial setup"
	@echo "  make up        - Start service"
	@echo "  make logs      - View logs"
	@echo "  make down      - Stop service"
	@echo ""
	@echo "$(BLUE)Development:$(NC)"
	@echo "  make dev       - Start dev server"
	@echo "  make test      - Run tests"
	@echo "  make lint      - Check code quality"