#!/bin/bash

# PostgreSQL S3 Backup - Build Script
# This script handles building the application for different environments

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

# Default values
BUILD_TYPE="production"
RUN_TESTS=true
RUN_LINT=true
CLEAN_BUILD=true
DOCKER_BUILD=false

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

Build PostgreSQL S3 Backup application.

OPTIONS:
    --type TYPE                Build type: development, production (default: production)
    --skip-tests              Skip running tests
    --skip-lint               Skip linting
    --no-clean                Don't clean before building
    --docker                  Build Docker image after TypeScript build
    -h, --help                Show this help message

EXAMPLES:
    # Production build with all checks
    $0

    # Development build without tests
    $0 --type development --skip-tests

    # Build with Docker image
    $0 --docker

EOF
}

# Function to clean build artifacts
clean_build() {
    if [[ "$CLEAN_BUILD" == true ]]; then
        print_status "Cleaning build artifacts..."
        cd "$PROJECT_ROOT"
        npm run clean
        print_success "Build artifacts cleaned"
    fi
}

# Function to install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    cd "$PROJECT_ROOT"
    
    if [[ "$BUILD_TYPE" == "production" ]]; then
        npm ci --only=production
    else
        npm ci
    fi
    
    print_success "Dependencies installed"
}

# Function to run type checking
run_type_check() {
    print_status "Running TypeScript type checking..."
    cd "$PROJECT_ROOT"
    
    if ! npm run type-check; then
        print_error "TypeScript type checking failed"
        return 1
    fi
    
    print_success "Type checking passed"
}

# Function to run linting
run_lint() {
    if [[ "$RUN_LINT" == true ]]; then
        print_status "Running code linting..."
        cd "$PROJECT_ROOT"
        
        if ! npm run lint; then
            print_error "Code linting failed"
            return 1
        fi
        
        print_success "Linting passed"
    fi
}

# Function to run tests
run_tests() {
    if [[ "$RUN_TESTS" == true ]]; then
        print_status "Running tests..."
        cd "$PROJECT_ROOT"
        
        if ! npm run test:ci; then
            print_error "Tests failed"
            return 1
        fi
        
        print_success "All tests passed"
    fi
}

# Function to build TypeScript
build_typescript() {
    print_status "Building TypeScript application..."
    cd "$PROJECT_ROOT"
    
    if ! npm run build; then
        print_error "TypeScript build failed"
        return 1
    fi
    
    print_success "TypeScript build completed"
}

# Function to build Docker image
build_docker() {
    if [[ "$DOCKER_BUILD" == true ]]; then
        print_status "Building Docker image..."
        cd "$PROJECT_ROOT"
        
        local image_tag="postgres-s3-backup:latest"
        if [[ "$BUILD_TYPE" == "development" ]]; then
            image_tag="postgres-s3-backup:dev"
        fi
        
        if ! docker build -t "$image_tag" .; then
            print_error "Docker build failed"
            return 1
        fi
        
        print_success "Docker image built: $image_tag"
    fi
}

# Function to show build summary
show_build_summary() {
    print_success "Build Summary"
    echo "==============="
    echo "Build Type: $BUILD_TYPE"
    echo "Tests Run: $RUN_TESTS"
    echo "Linting Run: $RUN_LINT"
    echo "Clean Build: $CLEAN_BUILD"
    echo "Docker Build: $DOCKER_BUILD"
    echo ""
    
    # Show build artifacts
    if [[ -d "$PROJECT_ROOT/dist" ]]; then
        print_status "Build artifacts in dist/:"
        ls -la "$PROJECT_ROOT/dist/"
    fi
    
    # Show Docker images if built
    if [[ "$DOCKER_BUILD" == true ]]; then
        print_status "Docker images:"
        docker images | grep postgres-s3-backup || true
    fi
}

# Main build function
main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --type)
                BUILD_TYPE="$2"
                shift 2
                ;;
            --skip-tests)
                RUN_TESTS=false
                shift
                ;;
            --skip-lint)
                RUN_LINT=false
                shift
                ;;
            --no-clean)
                CLEAN_BUILD=false
                shift
                ;;
            --docker)
                DOCKER_BUILD=true
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
    
    # Validate build type
    if [[ "$BUILD_TYPE" != "development" && "$BUILD_TYPE" != "production" ]]; then
        print_error "Invalid build type: $BUILD_TYPE"
        print_status "Valid types: development, production"
        exit 1
    fi
    
    print_status "Starting $BUILD_TYPE build..."
    
    # Execute build steps
    clean_build
    install_dependencies
    run_type_check
    run_lint
    run_tests
    build_typescript
    build_docker
    
    # Show summary
    show_build_summary
    
    print_success "Build completed successfully!"
}

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi