#!/bin/bash

# PostgreSQL S3 Backup - Docker Hub Setup Script
# This script helps set up Docker Hub publishing for your repository

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

Set up Docker Hub publishing for PostgreSQL S3 Backup.

OPTIONS:
    --username USERNAME     Docker Hub username
    --repository REPO       Docker Hub repository name (default: postgres-s3-backup)
    --check-only           Only check current setup, don't make changes
    -h, --help             Show this help message

EXAMPLES:
    # Interactive setup
    $0

    # Setup with specific username
    $0 --username myusername

    # Check current setup
    $0 --check-only

EOF
}

# Function to check if GitHub CLI is installed
check_gh_cli() {
    if ! command -v gh &> /dev/null; then
        print_warning "GitHub CLI (gh) is not installed"
        print_status "Install it from: https://cli.github.com/"
        return 1
    fi
    return 0
}

# Function to check if user is logged in to GitHub CLI
check_gh_auth() {
    if ! gh auth status &> /dev/null; then
        print_warning "Not authenticated with GitHub CLI"
        print_status "Run: gh auth login"
        return 1
    fi
    return 0
}

# Function to get repository information
get_repo_info() {
    if command -v gh &> /dev/null && gh auth status &> /dev/null; then
        REPO_OWNER=$(gh repo view --json owner --jq '.owner.login' 2>/dev/null || echo "")
        REPO_NAME=$(gh repo view --json name --jq '.name' 2>/dev/null || echo "")
        REPO_URL=$(gh repo view --json url --jq '.url' 2>/dev/null || echo "")
    else
        # Fallback to git remote
        REPO_URL=$(git remote get-url origin 2>/dev/null || echo "")
        if [[ $REPO_URL =~ github\.com[:/]([^/]+)/([^/]+)(\.git)?$ ]]; then
            REPO_OWNER="${BASH_REMATCH[1]}"
            REPO_NAME="${BASH_REMATCH[2]}"
            REPO_NAME="${REPO_NAME%.git}"
        fi
    fi
}

# Function to check current GitHub secrets
check_github_secrets() {
    print_status "Checking GitHub repository secrets..."
    
    if ! check_gh_cli || ! check_gh_auth; then
        print_warning "Cannot check GitHub secrets without GitHub CLI"
        return 1
    fi
    
    local secrets_output
    secrets_output=$(gh secret list 2>/dev/null || echo "")
    
    local has_docker_username=false
    local has_docker_password=false
    
    if echo "$secrets_output" | grep -q "DOCKER_USERNAME"; then
        has_docker_username=true
        print_success "DOCKER_USERNAME secret is configured"
    else
        print_warning "DOCKER_USERNAME secret is missing"
    fi
    
    if echo "$secrets_output" | grep -q "DOCKER_PASSWORD"; then
        has_docker_password=true
        print_success "DOCKER_PASSWORD secret is configured"
    else
        print_warning "DOCKER_PASSWORD secret is missing"
    fi
    
    if [[ "$has_docker_username" == true && "$has_docker_password" == true ]]; then
        return 0
    else
        return 1
    fi
}

# Function to set GitHub secrets
set_github_secrets() {
    local docker_username="$1"
    local docker_password="$2"
    
    print_status "Setting GitHub repository secrets..."
    
    if ! check_gh_cli || ! check_gh_auth; then
        print_error "GitHub CLI is required to set secrets"
        return 1
    fi
    
    # Set DOCKER_USERNAME secret
    if echo "$docker_username" | gh secret set DOCKER_USERNAME; then
        print_success "DOCKER_USERNAME secret set successfully"
    else
        print_error "Failed to set DOCKER_USERNAME secret"
        return 1
    fi
    
    # Set DOCKER_PASSWORD secret
    if echo "$docker_password" | gh secret set DOCKER_PASSWORD; then
        print_success "DOCKER_PASSWORD secret set successfully"
    else
        print_error "Failed to set DOCKER_PASSWORD secret"
        return 1
    fi
    
    return 0
}

# Function to update workflow file with correct username
update_workflow_file() {
    local docker_username="$1"
    local workflow_file=".github/workflows/docker-publish.yml"
    
    if [[ ! -f "$workflow_file" ]]; then
        print_error "Workflow file not found: $workflow_file"
        return 1
    fi
    
    print_status "Updating workflow file with Docker Hub username..."
    
    # Create a backup
    cp "$workflow_file" "$workflow_file.backup"
    
    # Update the workflow file (this is a simple replacement, in a real scenario you might want more sophisticated parsing)
    if sed -i.tmp "s/username\/postgres-s3-backup/${docker_username}\/postgres-s3-backup/g" "$workflow_file" 2>/dev/null; then
        rm -f "$workflow_file.tmp"
        print_success "Workflow file updated successfully"
    else
        # Fallback for systems where sed -i works differently
        sed "s/username\/postgres-s3-backup/${docker_username}\/postgres-s3-backup/g" "$workflow_file.backup" > "$workflow_file"
        print_success "Workflow file updated successfully"
    fi
    
    rm -f "$workflow_file.backup"
}

# Function to update docker-compose.yml with correct username
update_docker_compose() {
    local docker_username="$1"
    local compose_file="docker-compose.yml"
    
    if [[ ! -f "$compose_file" ]]; then
        print_warning "Docker Compose file not found: $compose_file"
        return 0
    fi
    
    print_status "Updating Docker Compose file with Docker Hub username..."
    
    # Create a backup
    cp "$compose_file" "$compose_file.backup"
    
    # Update the compose file
    if sed -i.tmp "s/username\/postgres-s3-backup/${docker_username}\/postgres-s3-backup/g" "$compose_file" 2>/dev/null; then
        rm -f "$compose_file.tmp"
        print_success "Docker Compose file updated successfully"
    else
        # Fallback for systems where sed -i works differently
        sed "s/username\/postgres-s3-backup/${docker_username}\/postgres-s3-backup/g" "$compose_file.backup" > "$compose_file"
        print_success "Docker Compose file updated successfully"
    fi
    
    rm -f "$compose_file.backup"
}

# Function to update README with correct username
update_readme() {
    local docker_username="$1"
    local readme_file="README.md"
    
    if [[ ! -f "$readme_file" ]]; then
        print_warning "README file not found: $readme_file"
        return 0
    fi
    
    print_status "Updating README with Docker Hub username..."
    
    # Create a backup
    cp "$readme_file" "$readme_file.backup"
    
    # Update the README file
    if sed -i.tmp "s/username\/postgres-s3-backup/${docker_username}\/postgres-s3-backup/g" "$readme_file" 2>/dev/null; then
        rm -f "$readme_file.tmp"
        print_success "README file updated successfully"
    else
        # Fallback for systems where sed -i works differently
        sed "s/username\/postgres-s3-backup/${docker_username}\/postgres-s3-backup/g" "$readme_file.backup" > "$readme_file"
        print_success "README file updated successfully"
    fi
    
    rm -f "$readme_file.backup"
}

# Function to validate Docker Hub credentials
validate_docker_credentials() {
    local username="$1"
    local password="$2"
    
    print_status "Validating Docker Hub credentials..."
    
    # Try to login to Docker Hub
    if echo "$password" | docker login --username "$username" --password-stdin &> /dev/null; then
        print_success "Docker Hub credentials are valid"
        docker logout &> /dev/null
        return 0
    else
        print_error "Invalid Docker Hub credentials"
        return 1
    fi
}

# Function to check if Docker Hub repository exists
check_docker_repository() {
    local username="$1"
    local repository="$2"
    
    print_status "Checking if Docker Hub repository exists..."
    
    # Use curl to check if repository exists
    local response_code
    response_code=$(curl -s -o /dev/null -w "%{http_code}" "https://hub.docker.com/v2/repositories/${username}/${repository}/")
    
    if [[ "$response_code" == "200" ]]; then
        print_success "Docker Hub repository ${username}/${repository} exists"
        return 0
    elif [[ "$response_code" == "404" ]]; then
        print_warning "Docker Hub repository ${username}/${repository} does not exist"
        print_status "You can create it at: https://hub.docker.com/repository/create"
        return 1
    else
        print_warning "Could not verify Docker Hub repository (HTTP $response_code)"
        return 1
    fi
}

# Main setup function
main() {
    local docker_username=""
    local docker_repository="postgres-s3-backup"
    local check_only=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --username)
                docker_username="$2"
                shift 2
                ;;
            --repository)
                docker_repository="$2"
                shift 2
                ;;
            --check-only)
                check_only=true
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
    
    print_status "PostgreSQL S3 Backup - Docker Hub Setup"
    echo "========================================"
    
    # Get repository information
    get_repo_info
    
    if [[ -n "$REPO_OWNER" && -n "$REPO_NAME" ]]; then
        print_status "Repository: $REPO_OWNER/$REPO_NAME"
    else
        print_warning "Could not determine repository information"
    fi
    
    # Check current setup
    if check_github_secrets; then
        print_success "GitHub secrets are already configured"
        if [[ "$check_only" == true ]]; then
            exit 0
        fi
    else
        if [[ "$check_only" == true ]]; then
            print_error "GitHub secrets are not properly configured"
            exit 1
        fi
    fi
    
    # Get Docker Hub username if not provided
    if [[ -z "$docker_username" ]]; then
        echo
        read -p "Enter your Docker Hub username: " docker_username
        
        if [[ -z "$docker_username" ]]; then
            print_error "Docker Hub username is required"
            exit 1
        fi
    fi
    
    # Get Docker Hub password/token
    echo
    print_status "Enter your Docker Hub access token (not your password!)"
    print_status "Create one at: https://hub.docker.com/settings/security"
    read -s -p "Docker Hub access token: " docker_password
    echo
    
    if [[ -z "$docker_password" ]]; then
        print_error "Docker Hub access token is required"
        exit 1
    fi
    
    # Validate credentials if Docker is available
    if command -v docker &> /dev/null; then
        if ! validate_docker_credentials "$docker_username" "$docker_password"; then
            exit 1
        fi
    else
        print_warning "Docker not found, skipping credential validation"
    fi
    
    # Check if repository exists
    check_docker_repository "$docker_username" "$docker_repository"
    
    # Set GitHub secrets
    if ! set_github_secrets "$docker_username" "$docker_password"; then
        exit 1
    fi
    
    # Update files with correct username
    update_workflow_file "$docker_username"
    update_docker_compose "$docker_username"
    update_readme "$docker_username"
    
    echo
    print_success "Docker Hub setup completed successfully!"
    echo
    print_status "Next steps:"
    echo "1. Commit and push your changes to trigger the first build"
    echo "2. Create a release (e.g., v1.0.0) to publish versioned images"
    echo "3. Check the Actions tab in GitHub to monitor the build"
    echo "4. Visit https://hub.docker.com/r/${docker_username}/${docker_repository} to see your published images"
    echo
    print_status "To create a release:"
    echo "  git tag v1.0.0"
    echo "  git push origin v1.0.0"
    echo
    print_status "Or use GitHub CLI:"
    echo "  gh release create v1.0.0 --title 'v1.0.0' --notes 'Initial release'"
}

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi