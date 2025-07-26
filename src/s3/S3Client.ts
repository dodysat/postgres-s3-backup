import {
  S3Client as AWSS3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { BackupConfig } from '../interfaces/BackupConfig';
import { S3Object } from '../interfaces/S3Client';
import * as fs from 'fs';

export class S3Client {
  private s3Client: AWSS3Client;
  private config: BackupConfig;

  constructor(config: BackupConfig) {
    this.config = config;

    // Initialize S3 client with configuration
    const clientConfig: any = {
      region: 'us-east-1', // Default region, can be overridden
      credentials: {
        accessKeyId: config.s3AccessKey,
        secretAccessKey: config.s3SecretKey,
      },
    };

    // Add endpoint and forcePathStyle only if s3Url is provided
    if (config.s3Url) {
      clientConfig.endpoint = config.s3Url;
      clientConfig.forcePathStyle = true; // Required for custom endpoints
    }

    this.s3Client = new AWSS3Client(clientConfig);
  }

  public async uploadFile(filePath: string, key: string): Promise<string> {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Read file as buffer
      const fileBuffer = fs.readFileSync(filePath);
      const fileStats = fs.statSync(filePath);

      console.log(
        `Uploading file ${filePath} (${fileStats.size} bytes) to S3 key: ${key}`
      );

      // Create upload command
      const uploadCommand = new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: 'application/gzip',
        Metadata: {
          'original-filename': filePath.split('/').pop() || 'unknown',
          'upload-timestamp': new Date().toISOString(),
          'file-size': fileStats.size.toString(),
        },
      });

      // Execute upload with retry logic
      await this.executeWithRetry(async () => {
        return await this.s3Client.send(uploadCommand);
      });

      const s3Location = `s3://${this.config.s3Bucket}/${key}`;
      console.log(`Successfully uploaded to: ${s3Location}`);

      return s3Location;
    } catch (error) {
      console.error(`Failed to upload file ${filePath} to S3:`, error);
      throw new Error(
        `S3 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  public async listObjects(prefix: string): Promise<S3Object[]> {
    try {
      console.log(
        `Listing objects in bucket ${this.config.s3Bucket} with prefix: ${prefix}`
      );

      const listCommand = new ListObjectsV2Command({
        Bucket: this.config.s3Bucket,
        Prefix: prefix,
      });

      const result = await this.s3Client.send(listCommand);

      if (!result.Contents) {
        console.log('No objects found with the specified prefix');
        return [];
      }

      const objects: S3Object[] = result.Contents.map((item) => ({
        key: item.Key!,
        lastModified: item.LastModified!,
        size: item.Size || 0,
      }));

      console.log(`Found ${objects.length} objects with prefix: ${prefix}`);
      return objects;
    } catch (error) {
      console.error(`Failed to list objects in S3:`, error);
      throw new Error(
        `S3 list objects failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  public async deleteObject(key: string): Promise<void> {
    try {
      console.log(`Deleting object from S3: ${key}`);

      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
      });

      await this.s3Client.send(deleteCommand);
      console.log(`Successfully deleted object: ${key}`);
    } catch (error) {
      console.error(`Failed to delete object ${key} from S3:`, error);
      throw new Error(
        `S3 delete object failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  public async testConnection(): Promise<boolean> {
    try {
      // Test connection by listing objects with a non-existent prefix
      const listCommand = new ListObjectsV2Command({
        Bucket: this.config.s3Bucket,
        Prefix: 'test-connection-prefix-that-does-not-exist-12345',
        MaxKeys: 1,
      });

      await this.s3Client.send(listCommand);
      console.log('S3 connection test successful');
      return true;
    } catch (error) {
      console.error('S3 connection test failed:', error);
      return false;
    }
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        if (attempt === maxRetries) {
          throw lastError;
        }

        // Check if error is retryable
        if (!this.isRetryableError(lastError)) {
          throw lastError;
        }

        // Calculate delay with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(
          `S3 operation failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`,
          lastError.message
        );

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  private isRetryableError(error: Error): boolean {
    const retryableErrors = [
      'NetworkingError',
      'TimeoutError',
      'ThrottlingException',
      'RequestTimeout',
      'ServiceUnavailable',
      'InternalServerError',
    ];

    return retryableErrors.some(
      (errorType) =>
        error.name.includes(errorType) || error.message.includes(errorType)
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
