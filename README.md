# PostgreSQL S3 Backup

A containerized service that automatically creates compressed PostgreSQL database backups and uploads them to Amazon S3 on a configurable schedule.

## Features

- 🔄 **Automated Backups**: Scheduled backups using cron expressions
- 🗜️ **Compression**: Gzip compression to minimize storage space
- 🗂️ **S3 Storage**: Secure upload to Amazon S3 with custom endpoints support
- 🧹 **Retention Management**: Automatic cleanup of old backups
- 🛡️ **Security**: Non-root container execution, credential sanitization
- 📊 **Logging**: Structured JSON logging with Winston
- 🔄 **Error Recovery**: Retry logic with exponential backoff for S3 operations
- 🐳 **Docker Ready**: Complete Docker and Docker Compose support

## Quick Start

### Using Docker Compose

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd pg-backup
   ```

2. **Configure environment variables**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Start the service**
   ```bash
   docker-compose up -d
   ```

### Using Docker

1. **Build the image**
   ```bash
   docker build -t pg-backup .
   ```

2. **Run with environment variables**
   ```bash
   docker run -d \
     --name pg-backup \
     -e S3_BUCKET=my-backup-bucket \
     -e S3_ACCESS_KEY=your-key \
     -e S3_SECRET_KEY=your-secret \
     -e POSTGRES_CONNECTION_STRING=postgresql://user:pass@host:5432/db \
     -e BACKUP_INTERVAL="0 2 * * *" \
     pg-backup
   ```

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `S3_BUCKET` | S3 bucket name | `my-backup-bucket` |
| `S3_ACCESS_KEY` | AWS access key | `AKIA...` |
| `S3_SECRET_KEY` | AWS secret key | `secret...` |
| `POSTGRES_CONNECTION_STRING` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `BACKUP_INTERVAL` | Cron expression for backup schedule | `0 2 * * *` (daily at 2 AM) |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `S3_URL` | Custom S3 endpoint URL | AWS S3 default |
| `S3_PATH` | S3 key prefix for backups | `postgres-backup` |
| `BACKUP_RETENTION_DAYS` | Days to keep backups (0 = keep all) | `undefined` (keep all) |
| `LOG_LEVEL` | Logging level | `info` |

### Cron Expression Examples

| Schedule | Expression | Description |
|----------|------------|-------------|
| Daily at 2 AM | `0 2 * * *` | Every day at 2:00 AM |
| Every 6 hours | `0 */6 * * *` | Every 6 hours |
| Weekly on Sunday | `0 2 * * 0` | Every Sunday at 2:00 AM |
| Monthly on 1st | `0 2 1 * *` | 1st of every month at 2:00 AM |

## Development

### Prerequisites

- Node.js 22+
- Docker (for containerized development)
- PostgreSQL client tools

### Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Build the project**
   ```bash
   npm run build
   ```

3. **Run tests**
   ```bash
   npm test
   npm run test:coverage
   npm run test:integration
   ```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build TypeScript to JavaScript |
| `npm run start` | Start the application |
| `npm run dev` | Start in development mode |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |
| `npm run docker:build` | Build Docker image |
| `npm run docker:compose` | Start with Docker Compose |

## Architecture

The application consists of several key components:

- **ConfigurationManager**: Validates and manages environment variables
- **PostgreSQLClient**: Handles database connections and backup creation
- **S3Client**: Manages S3 uploads with retry logic
- **RetentionManager**: Handles backup lifecycle and cleanup
- **BackupManager**: Orchestrates the complete backup process
- **CronScheduler**: Manages scheduled execution
- **Logger**: Provides structured logging

## File Naming

Backup files follow this pattern:
```
{S3_PATH}/postgres-backup-{YYYY-MM-DD_HH-MM-SS}.sql.gz
```

Example: `backups/postgres-backup-2024-01-15_14-30-00.sql.gz`

## Security Considerations

- **Non-root execution**: Container runs as `node` user
- **Credential sanitization**: Sensitive data is redacted in logs
- **Minimal attack surface**: Alpine Linux base image
- **Network security**: Supports custom S3 endpoints for private clouds

## Troubleshooting

### Common Issues

1. **PostgreSQL connection failed**
   - Verify connection string format
   - Check network connectivity
   - Ensure PostgreSQL is running and accessible

2. **S3 upload failed**
   - Verify AWS credentials
   - Check S3 bucket permissions
   - Ensure bucket exists and is accessible

3. **Backup file not created**
   - Check PostgreSQL client tools are installed
   - Verify database permissions
   - Check available disk space

### Logs

The application uses structured JSON logging. Check logs for detailed error information:

```bash
# Docker Compose
docker-compose logs -f

# Docker
docker logs pg-backup

# Direct
npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

MIT License - see LICENSE file for details. 