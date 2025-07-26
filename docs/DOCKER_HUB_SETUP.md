# Docker Hub Publishing Setup

This document explains how to set up automated Docker image publishing to Docker Hub using GitHub Actions.

## Overview

The GitHub Action workflow (`.github/workflows/docker-publish.yml`) automatically:

- **Tests the code** before building (type checking, linting, formatting, unit tests)
- **Builds multi-platform Docker images** (linux/amd64, linux/arm64)
- **Publishes to Docker Hub** on pushes to main/master branch and version tags
- **Creates version tags** following semantic versioning (v1.2.3 format)
- **Updates Docker Hub description** with the README content
- **Generates build attestations** for security and provenance

## Prerequisites

1. **Docker Hub Account**: Create an account at [hub.docker.com](https://hub.docker.com)
2. **Docker Hub Repository**: Create a public repository named `postgres-s3-backup`
3. **GitHub Repository**: Your code repository on GitHub

## Setup Instructions

### 1. Create Docker Hub Access Token

1. Log in to [Docker Hub](https://hub.docker.com)
2. Go to **Account Settings** → **Security**
3. Click **New Access Token**
4. Name: `GitHub Actions - postgres-s3-backup`
5. Permissions: **Read, Write, Delete**
6. Copy the generated token (you won't see it again!)

### 2. Configure GitHub Secrets

In your GitHub repository, go to **Settings** → **Secrets and variables** → **Actions** and add:

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `DOCKER_USERNAME` | Your Docker Hub username | Used for authentication |
| `DOCKER_PASSWORD` | Your Docker Hub access token | Used for authentication |

### 3. Repository Settings

Ensure your GitHub repository has the following settings:

- **Actions permissions**: Allow GitHub Actions to run
- **Workflow permissions**: Read and write permissions for GITHUB_TOKEN

## How It Works

### Automatic Triggers

The workflow runs automatically on:

1. **Push to main/master branch**: Builds and pushes `latest` tag
2. **Version tags**: Push tags like `v1.2.3` to create versioned releases
3. **Pull requests**: Builds images for testing (doesn't push to Docker Hub)

### Image Tags

The workflow creates multiple tags for each build:

| Trigger | Tags Created | Example |
|---------|--------------|---------|
| Push to main | `latest` | `username/postgres-s3-backup:latest` |
| Version tag v1.2.3 | `1.2.3`, `1.2`, `1`, `latest` | `username/postgres-s3-backup:1.2.3` |
| Branch push | `branch-name` | `username/postgres-s3-backup:feature-branch` |

### Multi-Platform Support

Images are built for multiple architectures:
- `linux/amd64` (Intel/AMD 64-bit)
- `linux/arm64` (ARM 64-bit, including Apple Silicon)

## Creating Releases

### Method 1: GitHub Releases (Recommended)

1. Go to your GitHub repository
2. Click **Releases** → **Create a new release**
3. Choose a tag: `v1.2.3` (must start with 'v')
4. Release title: `v1.2.3`
5. Describe the changes
6. Click **Publish release**

This will automatically trigger the Docker build and publish the versioned images.

### Method 2: Git Tags

```bash
# Create and push a version tag
git tag v1.2.3
git push origin v1.2.3
```

### Method 3: GitHub CLI

```bash
# Create a release with GitHub CLI
gh release create v1.2.3 --title "v1.2.3" --notes "Release notes here"
```

## Usage Examples

### Pull Latest Image

```bash
# Pull the latest version
docker pull username/postgres-s3-backup:latest

# Run the container
docker run --env-file .env username/postgres-s3-backup:latest
```

### Pull Specific Version

```bash
# Pull a specific version
docker pull username/postgres-s3-backup:1.2.3

# Pull latest patch version of 1.2.x
docker pull username/postgres-s3-backup:1.2

# Pull latest minor version of 1.x.x
docker pull username/postgres-s3-backup:1
```

### Docker Compose

Update your `docker-compose.yml` to use the published image:

```yaml
version: '3.8'
services:
  postgres-backup:
    image: username/postgres-s3-backup:latest
    # or use a specific version:
    # image: username/postgres-s3-backup:1.2.3
    container_name: postgres-s3-backup
    restart: unless-stopped
    env_file: .env
```

## Monitoring Builds

### GitHub Actions

1. Go to your repository → **Actions** tab
2. Click on **Build and Publish Docker Image** workflow
3. View build logs and status

### Docker Hub

1. Go to [Docker Hub](https://hub.docker.com)
2. Navigate to your repository
3. Check the **Tags** tab for published images
4. View download statistics and image details

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Check `DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets
   - Ensure the access token has correct permissions
   - Verify the Docker Hub repository exists

2. **Build Failures**
   - Check the GitHub Actions logs
   - Ensure tests pass locally: `npm run test:ci`
   - Verify Dockerfile syntax

3. **Multi-platform Build Issues**
   - Some dependencies might not support all platforms
   - Check build logs for platform-specific errors

### Debug Commands

```bash
# Test Docker build locally
docker build -t postgres-s3-backup:test .

# Test multi-platform build (requires buildx)
docker buildx build --platform linux/amd64,linux/arm64 -t postgres-s3-backup:test .

# Run tests locally
npm run validate
```

## Security Considerations

1. **Access Tokens**: Use Docker Hub access tokens, not passwords
2. **Secrets Management**: Store credentials in GitHub Secrets, never in code
3. **Image Scanning**: Consider adding vulnerability scanning to the workflow
4. **Attestations**: The workflow generates build attestations for supply chain security

## Customization

### Change Image Name

Edit `.github/workflows/docker-publish.yml`:

```yaml
env:
  IMAGE_NAME: your-custom-name
```

### Add Image Scanning

Add this step before pushing:

```yaml
- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ${{ steps.meta.outputs.tags }}
    format: 'sarif'
    output: 'trivy-results.sarif'
```

### Custom Build Args

Add build arguments:

```yaml
build-args: |
  CUSTOM_ARG=value
  ANOTHER_ARG=${{ github.sha }}
```

## Best Practices

1. **Semantic Versioning**: Use proper version tags (v1.2.3)
2. **Release Notes**: Always include meaningful release notes
3. **Testing**: Ensure all tests pass before releasing
4. **Security**: Regularly update base images and dependencies
5. **Documentation**: Keep README and docs up to date
6. **Monitoring**: Monitor image downloads and usage

## Support

For issues with:
- **GitHub Actions**: Check repository Actions tab and logs
- **Docker Hub**: Visit [Docker Hub Support](https://hub.docker.com/support)
- **This Project**: Create an issue in the GitHub repository