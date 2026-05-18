import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export interface StorageAdapter {
  upload(buffer: Buffer, key: string): Promise<string>
}

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client
  private bucket: string

  constructor() {
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
      forcePathStyle: true,
    })
    this.bucket = process.env.S3_BUCKET ?? 'pdf-outputs'
  }

  async upload(buffer: Buffer, key: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: 'application/pdf',
      }),
    )
    if (process.env.S3_ENDPOINT) {
      return `${process.env.S3_ENDPOINT}/${this.bucket}/${key}`
    }
    return `https://${this.bucket}.s3.amazonaws.com/${key}`
  }
}
