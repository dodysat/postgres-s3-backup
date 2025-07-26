/**
 * Represents an S3 object with metadata
 */
export interface S3Object {
  /** S3 object key */
  key: string;

  /** Last modified timestamp */
  lastModified: Date;

  /** Size of the object in bytes */
  size: number;
}

/**
 * Interface for S3 operations
 */
export interface S3Client {
  /** Upload a file to S3 */
  uploadFile(filePath: string, key: string): Promise<string>;

  /** List objects in S3 with optional prefix filter */
  listObjects(prefix: string): Promise<S3Object[]>;

  /** Delete an object from S3 */
  deleteObject(key: string): Promise<void>;

  /** Test S3 connectivity and permissions */
  testConnection(): Promise<boolean>;
}
