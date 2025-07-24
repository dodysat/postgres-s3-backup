import {
  S3Client as AWSS3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommandInput,
  ListObjectsV2CommandInput,
  DeleteObjectCommandInput,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { S3Client as IS3Client, S3Object } from '../interfaces/S3Client';
import { BackupConfig } from '../interfaces/BackupConfig';

/**
 * S3Client implementation using AWS SDK v3
 * Provides file upload, listing, and deletion capabilities with retry logic
 */
export class S3Client implements IS3Client {
  private client: AWSS3Client;
  private bucket: string;
  private maxRetries: number = 3;
  private baseDelay: number = 1000; // 1 second

  constructor(config: BackupConfig) {
    const clientConfig: any = {
      region: 'us-east-1', // Default region
      credentials: {
        accessKeyId: config.s3AccessKey,
        secretAccessKey: config.s3SecretKey,
      },
    };

    // Use custom endpoint if provided (for S3-compatible services)
    if (config.s3Url) {
      clientConfig.endpoint = config.s3Url;
      clientConfig.forcePathStyle = true; // Required for MinIO and other S3-compatible services
    }

    this.client = new AWSS3Client(clientConfig);
    this.bucket = config.s3Bucket;
  }

  /**
   * Upload a file to S3 with retry logic
   */
  async uploadFile(filePath: string, key: string): Promise<string> {
    return this.withRetry(async () => {
      // Get file stats for content length
      const fileStats = await stat(filePath);
      const fileStream = createReadStream(filePath);

      const uploadParams: PutObjectCommandInput = {
        Bucket: this.bucket,
        Key: key,
        Body: fileStream,
        ContentLength: fileStats.size,
        ContentType: 'application/gzip',
        ContentEncoding: 'gzip',
      };

      const command = new PutObjectCommand(uploadParams);
      await this.client.send(command);

      return `s3://${this.bucket}/${key}`;
    }, `upload file ${filePath} to ${key}`);
  }

  /**
   * List objects in S3 with optional prefix filter
   */
  async listObjects(prefix: string): Promise<S3Object[]> {
    return this.withRetry(async () => {
      const listParams: ListObjectsV2CommandInput = {
        Bucket: this.bucket,
        Prefix: prefix,
      };

      const command = new ListObjectsV2Command(listParams);
      const response = await this.client.send(command);

      if (!response.Contents) {
        return [];
      }

      return response.Contents.map(obj => ({
        key: obj.Key!,
        lastModified: obj.LastModified!,
        size: obj.Size || 0,
      }));
    }, `list objects with prefix ${prefix}`);
  }

  /**
   * Delete an object from S3
   */
  async deleteObject(key: string): Promise<void> {
    return this.withRetry(async () => {
      const deleteParams: DeleteObjectCommandInput = {
        Bucket: this.bucket,
        Key: key,
      };

      const command = new DeleteObjectCommand(deleteParams);
      await this.client.send(command);
    }, `delete object ${key}`);
  }

  /**
   * Test S3 connectivity and permissions
   */
  async testConnection(): Promise<boolean> {
    try {
      const command = new HeadBucketCommand({ Bucket: this.bucket });
      await this.client.send(command);
      return true;
    } catch (error) {
      console.error('S3 connection test failed:', error);
      return false;
    }
  }

  /**
   * Execute an operation with exponential backoff retry logic
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on certain error types
        if (this.isNonRetryableError(error)) {
          throw error;
        }

        if (attempt === this.maxRetries) {
          throw new Error(
            `Failed to ${operationName} after ${this.maxRetries} attempts. Last error: ${lastError.message}`
          );
        }

        // Calculate exponential backoff delay
        const delay = this.baseDelay * Math.pow(2, attempt - 1);
        console.warn(
          `Attempt ${attempt} failed for ${operationName}: ${lastError.message}. Retrying in ${delay}ms...`
        );
        
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Check if an error should not be retried
   */
  private isNonRetryableError(error: any): boolean {
    // Don't retry on authentication errors, permission errors, or invalid bucket names
    const nonRetryableCodes = [
      'InvalidAccessKeyId',
      'SignatureDoesNotMatch',
      'AccessDenied',
      'NoSuchBucket',
      'InvalidBucketName',
      'BucketNotEmpty',
    ];

    return nonRetryableCodes.includes(error.name) || 
           nonRetryableCodes.includes(error.Code) ||
           (error.$metadata?.httpStatusCode >= 400 && error.$metadata?.httpStatusCode < 500);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}