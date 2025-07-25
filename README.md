# PostgreSQL S3 Backup

Automated PostgreSQL database backup solution that uploads compressed backups to Amazon S3 on a configurable schedule.

## Quick Start with Docker Compose

### 1. Clone and Setup

```bash
git clone <repository-url>
cd postgres-s3-backup
cp .env.example .env
```

### 2. Configure Environment Variables

Edit the `.env` file with your specific configuration:

```bash
# Required settings
S3_BUCKET=your-backup-bucket
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
POSTGRES_CONNECTION_STRING=postgresql://user:pass@host:port/database
BACKUP_INTERVAL=0 2 * * *

# Optional settings
S3_PATH=postgres-backups
BACKUP_RETENTION_DAYS=30
LOG_LEVEL=info
```

### 3. Deploy

```bash
# Build and start the service
docker-compose up -d

# View logs
docker-compose logs -f postgres-backup

# Stop the service
docker-compose down
```

## Configuration Options

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `S3_BUCKET` | S3 bucket name for backups | `my-backup-bucket` |
| `S3_ACCESS_KEY` | AWS access key ID | `AKIAIOSFODNN7EXAMPLE` |
| `S3_SECRET_KEY` | AWS secret access key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `POSTGRES_CONNECTION_STRING` | PostgreSQL connection URL | `postgresql://user:pass@host:port/db` |
| `BACKUP_INTERVAL` | Cron schedule for backups | `0 2 * * *` (daily at 2 AM) |

### Optional Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `S3_URL` | Custom S3 endpoint | AWS S3 | `https://minio.example.com` |
| `S3_PATH` | S3 path prefix | `postgres-backups` | `backups/production` |
| `BACKUP_RETENTION_DAYS` | Days to keep backups | Keep all | `30` |
| `LOG_LEVEL` | Logging verbosity | `info` | `debug` |

## Customization Examples

### Multiple Database Backups

Create separate compose files for different databases:

```yaml
# docker-compose.db1.yml
version: '3.8'
services:
  postgres-backup-db1:
    extends:
      file: docker-compose.yml
      service: postgres-backup
    container_name: postgres-backup-db1
    environment:
      POSTGRES_CONNECTION_STRING: postgresql://user:pass@db1:5432/database1
      S3_PATH: backups/database1
```

Deploy multiple instances:
```bash
docker-compose -f docker-compose.yml -f docker-compose.db1.yml up -d
```

### Custom Resource Limits

Modify the `deploy.resources` section based on your database size:

```yaml
deploy:
  resources:
    limits:
      memory: 1G        # For large databases
      cpus: '1.0'
    reservations:
      memory: 512M
      cpus: '0.5'
```

### Network Isolation

Use custom networks for security:

```yaml
services:
  postgres-backup:
    # ... other config
    networks:
      - database-network
      - backup-network

networks:
  database-network:
    external: true
  backup-network:
    driver: bridge
```

### Production Deployment

For production environments, consider:

```yaml
services:
  postgres-backup:
    # ... other config
    restart: always
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    
    # Use secrets instead of environment variables
    secrets:
      - s3_access_key
      - s3_secret_key
      - postgres_password

secrets:
  s3_access_key:
    external: true
  s3_secret_key:
    external: true
  postgres_password:
    external: true
```

## Cron Schedule Examples

| Schedule | Description |
|----------|-------------|
| `0 2 * * *` | Daily at 2:00 AM |
| `0 */6 * * *` | Every 6 hours |
| `0 2 * * 0` | Weekly on Sunday at 2:00 AM |
| `0 2 1 * *` | Monthly on the 1st at 2:00 AM |
| `0 2 * * 1-5` | Weekdays only at 2:00 AM |

## Monitoring and Troubleshooting

### View Logs
```bash
# Follow logs in real-time
docker-compose logs -f postgres-backup

# View last 100 lines
docker-compose logs --tail=100 postgres-backup
```

### Health Check
```bash
# Check container status
docker-compose ps

# Check container health
docker inspect postgres-s3-backup | grep -A 10 Health
```

### Common Issues

1. **Connection Refused**: Check PostgreSQL connection string and network access
2. **S3 Access Denied**: Verify S3 credentials and bucket permissions
3. **Invalid Cron**: Validate cron expression format
4. **Out of Memory**: Increase memory limits for large databases

## Security Best Practices

1. **Credentials**: Use Docker secrets or external secret management
2. **Network**: Isolate backup containers in separate networks
3. **Permissions**: Use minimal S3 and PostgreSQL permissions
4. **Updates**: Regularly update the container image
5. **Monitoring**: Set up alerts for backup failures

## Development

### Building Locally
```bash
# Build the image
docker-compose build

# Run tests
npm test

# Development with hot reload
npm run dev
```

### Environment Setup
```bash
# Install dependencies
npm install

# Run TypeScript compilation
npm run build

# Run linting
npm run lint
```