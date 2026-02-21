import { BlobServiceClient } from '@azure/storage-blob';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type StorageProvider = 's3' | 'azure';

export type StorageConfig = {
  provider: StorageProvider;
  bucketOrContainer: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  azureConnectionString?: string;
};

export class FileStorageService {
  constructor(private readonly config: StorageConfig) {}

  async uploadText(path: string, content: string, contentType = 'text/plain'): Promise<string> {
    if (this.config.provider === 's3') {
      const client = new S3Client({
        region: this.config.s3Region ?? 'us-east-1',
        endpoint: this.config.s3Endpoint,
        forcePathStyle: true,
        credentials:
          this.config.s3AccessKey && this.config.s3SecretKey
            ? {
                accessKeyId: this.config.s3AccessKey,
                secretAccessKey: this.config.s3SecretKey,
              }
            : undefined,
      });

      await client.send(
        new PutObjectCommand({
          Bucket: this.config.bucketOrContainer,
          Key: path,
          Body: content,
          ContentType: contentType,
        }),
      );

      return `${this.config.s3Endpoint ?? 's3://local'}/${this.config.bucketOrContainer}/${path}`;
    }

    if (!this.config.azureConnectionString) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING is required for azure provider');
    }

    const serviceClient = BlobServiceClient.fromConnectionString(this.config.azureConnectionString);
    const container = serviceClient.getContainerClient(this.config.bucketOrContainer);
    await container.createIfNotExists();
    const blob = container.getBlockBlobClient(path);
    await blob.upload(content, Buffer.byteLength(content), {
      blobHTTPHeaders: { blobContentType: contentType },
    });

    return blob.url;
  }
}
