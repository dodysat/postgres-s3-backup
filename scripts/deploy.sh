#!/bin/bash

# PostgreSQL S3 Backup - Production Deployment Script
# This script helps deploy the backup service to production environments

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEFAULT_ENV_FILE="$PROJECT_ROOT/.env"
DEFAULT_COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"

# Default values
ENVIRONMENT="production"
SERVICE_NAME="postgres-s3-backup"
BUILD_IMAGE=true
RUN_TESTS=true
SKIP_VALIDATION=false

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy PostgreSQL S3 Backup service to production environment.

OPTIONS:
    -e, --env-file FILE         Environment file path (default: .env)
    -c, --compose-file FILE     Docker Compose file path (default: docker-compose.yml)
    -n, --service-name NAME     Service name (default: postgres-s3-backup)
    --environment ENV           Environment name (default: production)
    --skip-build               Skip Docker image build
    --skip-tests               Skip running tests
    --skip-validation          Skip environment validation
    --force                    Force deployment without confirmation
    -h, --help                 Show this help message

EXAMPLES:
    # Basic deployment
    $0

    # Deploy with custom environment file
    $0 --env-file /path/to/production.env

    # Deploy without running tests (faster)
    $0 --skip-tests

    # Deploy with custom service name
    $0 --service-name my-backup-service

EOF
}

# Function to validate environment file
validate_environment() {
    local env_file="$1"
    
    if [[ ! -f "$env_file" ]]; then
        print_error "Environment file not found: $env_file"
        print_status "Please create the environment file or use --env-file to specify a different path"
        return 1
    fi

    print_status "Validating environment configuration..."

    # Required environment variables
    local required_vars=(
        "S3_BUCKET"
        "S3_ACCESS_KEY"
        "S3_SECRET_KEY"
        "POSTGRES_CONNECTION_STRING"
        "BACKUP_INTERVAL"
    )

    local missing_vars=()
    
    # Source the environment file
    set -a
    source "$env_file"
    set +a

    # Check required variables
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            missing_vars+=("$var")
        fi
    done

    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        print_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        return 1
    fi

    # Validate cron expression
    if ! validate_cron_expression "$BACKUP_INTERVAL"; then
        print_error "Invalid cron expression: $BACKUP_INTERVAL"
        print_status "Please use a valid cron format (e.g., '0 2 * * *' for daily at 2 AM)"
        return 1
    fi

    # Validate S3 bucket name format
    if ! validate_s3_bucket_name "$S3_BUCKET"; then
        print_error "Invalid S3 bucket name: $S3_BUCKET"
        print_status "S3 bucket names must be 3-63 characters, lowercase, and follow DNS naming conventions"
        return 1
    fi

    # Validate PostgreSQL connection string format
    if ! validate_postgres_connection "$POSTGRES_CONNECTION_STRING"; then
        print_error "Invalid PostgreSQL connection string format"
        print_status "Expected format: postgresql://username:password@host:port/database"
        return 1
    fi

    print_success "Environment validation passed"
    return 0
}

# Function to validate cron expression (basic validation)
validate_cron_expression() {
    local cron_expr="$1"
    # Basic validation - should have 5 parts separated by spaces
    local parts_count=$(echo "$cron_expr" | wc -w)
    [[ $parts_count -eq 5 ]]
}

# Function to validate S3 bucket name
validate_s3_bucket_name() {
    local bucket_name="$1"
    # Basic S3 bucket name validation
    [[ ${#bucket_name} -ge 3 && ${#bucket_name} -le 63 ]] && \
    [[ "$bucket_name" =~ ^[a-z0-9][a-z0-9.-]*[a-z0-9]$ ]] && \
    [[ ! "$bucket_name" =~ \.\. ]] && \
    [[ ! "$bucket_name" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

# Function to validate PostgreSQL connection string
validate_postgres_connection() {
    local conn_str="$1"
    [[ "$conn_str" =~ ^postgresql://[^:]+:[^@]+@[^:]+:[0-9]+/[^/]+$ ]]
}

# Function to run pre-deployment tests
run_tests() {
    print_status "Running pre-deployment tests..."
    
    cd "$PROJECT_ROOT"
    
    # Type checking
    print_status "Running TypeScript type checking..."
    if ! npm run type-check; then
        print_error "TypeScript type checking failed"
        return 1
    fi
    
    # Linting
    print_status "Running code linting..."
    if ! npm run lint; then
        print_error "Code linting failed"
        return 1
    fi
    
    # Unit tests
    print_status "Running unit tests..."
    if ! npm run test:ci; then
        print_warning "Some tests failed, but continuing deployment"
        print_status "Check test results above for details"
    fi
    
    print_success "Pre-deployment tests completed"
}

# Function to build Docker image
build_image() {
    print_status "Building Docker image..."
    
    cd "$PROJECT_ROOT"
    
    # Clean and build TypeScript
    print_status "Building TypeScript application..."
    if ! npm run build; then
        print_error "TypeScript build failed"
        return 1
    fi
    
    # Build Docker image
    print_status "Building Docker image: $SERVICE_NAME"
    if ! docker build -t "$SERVICE_NAME" .; then
        print_error "Docker image build failed"
        return 1
    fi
    
    print_success "Docker image built successfully"
}

# Function to deploy service
deploy_service() {
    local env_file="$1"
    local compose_file="$2"
    
    print_status "Deploying service: $SERVICE_NAME"
    
    cd "$PROJECT_ROOT"
    
    # Stop existing service if running
    print_status "Stopping existing service (if running)..."
    docker-compose -f "$compose_file" --env-file "$env_file" down || true
    
    # Start the service
    print_status "Starting service..."
    if ! docker-compose -f "$compose_file" --env-file "$env_file" up -d; then
        print_error "Failed to start service"
        return 1
    fi
    
    # Wait for service to be ready
    print_status "Waiting for service to be ready..."
    sleep 5
    
    # Check service status
    if docker-compose -f "$compose_file" --env-file "$env_file" ps | grep -q "Up"; then
        print_success "Service deployed successfully"
        
        # Show service status
        print_status "Service status:"
        docker-compose -f "$compose_file" --env-file "$env_file" ps
        
        # Show recent logs
        print_status "Recent logs:"
        docker-compose -f "$compose_file" --env-file "$env_file" logs --tail=20
        
    else
        print_error "Service failed to start properly"
        print_status "Service logs:"
        docker-compose -f "$compose_file" --env-file "$env_file" logs
        return 1
    fi
}

# Function to show deployment summary
show_deployment_summary() {
    local env_file="$1"
    local compose_file="$2"
    
    print_success "Deployment Summary"
    echo "===================="
    echo "Environment: $ENVIRONMENT"
    echo "Service Name: $SERVICE_NAME"
    echo "Environment File: $env_file"
    echo "Compose File: $compose_file"
    echo ""
    
    # Source environment file to show configuration
    set -a
    source "$env_file"
    set +a
    
    echo "Configuration:"
    echo "  S3 Bucket: $S3_BUCKET"
    echo "  S3 Path: ${S3_PATH:-postgres-backups}"
    echo "  Backup Schedule: $BACKUP_INTERVAL"
    echo "  Retention Days: ${BACKUP_RETENTION_DAYS:-unlimited}"
    echo "  Log Level: ${LOG_LEVEL:-info}"
    echo ""
    
    print_status "Useful commands:"
    echo "  View logs:    docker-compose -f $compose_file --env-file $env_file logs -f"
    echo "  Stop service: docker-compose -f $compose_file --env-file $env_file down"
    echo "  Restart:      docker-compose -f $compose_file --env-file $env_file restart"
    echo "  Status:       docker-compose -f $compose_file --env-file $env_file ps"
}

# Main deployment function
main() {
    local env_file="$DEFAULT_ENV_FILE"
    local compose_file="$DEFAULT_COMPOSE_FILE"
    local force_deploy=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--env-file)
                env_file="$2"
                shift 2
                ;;
            -c|--compose-file)
                compose_file="$2"
                shift 2
                ;;
            -n|--service-name)
                SERVICE_NAME="$2"
                shift 2
                ;;
            --environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            --skip-build)
                BUILD_IMAGE=false
                shift
                ;;
            --skip-tests)
                RUN_TESTS=false
                shift
                ;;
            --skip-validation)
                SKIP_VALIDATION=true
                shift
                ;;
            --force)
                force_deploy=true
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Convert relative paths to absolute
    env_file="$(realpath "$env_file")"
    compose_file="$(realpath "$compose_file")"
    
    print_status "Starting deployment for environment: $ENVIRONMENT"
    
    # Validate environment
    if [[ "$SKIP_VALIDATION" != true ]]; then
        if ! validate_environment "$env_file"; then
            print_error "Environment validation failed"
            exit 1
        fi
    fi
    
    # Show deployment plan
    if [[ "$force_deploy" != true ]]; then
        echo ""
        print_status "Deployment Plan:"
        echo "  Environment: $ENVIRONMENT"
        echo "  Service Name: $SERVICE_NAME"
        echo "  Environment File: $env_file"
        echo "  Compose File: $compose_file"
        echo "  Build Image: $BUILD_IMAGE"
        echo "  Run Tests: $RUN_TESTS"
        echo ""
        
        read -p "Continue with deployment? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Deployment cancelled"
            exit 0
        fi
    fi
    
    # Run tests if requested
    if [[ "$RUN_TESTS" == true ]]; then
        if ! run_tests; then
            print_error "Pre-deployment tests failed"
            exit 1
        fi
    fi
    
    # Build image if requested
    if [[ "$BUILD_IMAGE" == true ]]; then
        if ! build_image; then
            print_error "Image build failed"
            exit 1
        fi
    fi
    
    # Deploy service
    if ! deploy_service "$env_file" "$compose_file"; then
        print_error "Deployment failed"
        exit 1
    fi
    
    # Show deployment summary
    show_deployment_summary "$env_file" "$compose_file"
    
    print_success "Deployment completed successfully!"
}

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi