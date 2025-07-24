export interface S3Object {
    key: string;
    lastModified: Date;
    size: number;
}
export interface S3Client {
    uploadFile(filePath: string, key: string): Promise<string>;
    listObjects(prefix: string): Promise<S3Object[]>;
    deleteObject(key: string): Promise<void>;
    testConnection(): Promise<boolean>;
}
//# sourceMappingURL=S3Client.d.ts.map