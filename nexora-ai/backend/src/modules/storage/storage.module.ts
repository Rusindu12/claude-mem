import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Body, Controller, Delete, Get, Module, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AuthenticatedUser, CurrentUser } from '../../common/auth.decorators';

const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
]);

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client | null = null;
  private readonly bucket: string;
  private readonly localRoot: string;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    this.bucket = process.env.S3_BUCKET || 'nexora-uploads';
    this.localRoot = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || './.storage');
    fs.mkdirSync(this.localRoot, { recursive: true });

    if (process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
      this.s3Client = new S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      });
      this.logger.log(`Connected S3-compatible object storage bucket: ${this.bucket}`);
    }
  }

  async uploadBase64File(
    userId: string,
    dto: {
      filename: string;
      mimeType: string;
      contentBase64: string;
      purpose?: 'CHAT_ATTACHMENT' | 'DOCUMENT_ANALYSIS' | 'IMAGE_EDIT' | 'VIDEO_SOURCE' | 'AVATAR';
    },
  ) {
    if (!dto.filename || !dto.mimeType || !dto.contentBase64) {
      throw new BadRequestException('filename, mimeType, and contentBase64 are required');
    }
    if (!ALLOWED_MIMES.has(dto.mimeType)) {
      throw new BadRequestException(`Unsupported or unsafe file MIME type: ${dto.mimeType}`);
    }

    const cleanB64 = dto.contentBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanB64, 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`File size must be between 1 byte and 15 MB`);
    }

    const safeName = path.basename(dto.filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const storageKey = `${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

    if (this.s3Client) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          Body: buffer,
          ContentType: dto.mimeType,
        }),
      );
    } else {
      const fullPath = path.join(this.localRoot, storageKey);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, buffer);
    }

    const extractedText = this.extractReadableText(buffer, dto.mimeType);
    const purpose = dto.purpose || 'CHAT_ATTACHMENT';
    const retentionExpires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

    const ins = await this.db.query<{ id: string; created_at: string }>(
      `INSERT INTO file_uploads (
         user_id, original_filename, storage_key, storage_bucket,
         mime_type, size_bytes, sha256_hash, extracted_text, purpose, retention_expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, created_at`,
      [
        userId,
        safeName,
        storageKey,
        this.bucket,
        dto.mimeType,
        buffer.byteLength,
        sha256Hash,
        extractedText,
        purpose,
        retentionExpires,
      ],
    );

    return {
      id: ins.rows[0].id,
      filename: safeName,
      mimeType: dto.mimeType,
      sizeBytes: buffer.byteLength,
      sha256Hash,
      purpose,
      hasExtractedText: Boolean(extractedText),
      createdAt: ins.rows[0].created_at,
    };
  }

  async getFileForUser(userId: string, fileId: string): Promise<{
    id: string;
    originalFilename: string;
    mimeType: string;
    extractedText: string | null;
    buffer: Buffer;
  }> {
    const res = await this.db.query<{
      id: string;
      original_filename: string;
      storage_key: string;
      mime_type: string;
      extracted_text: string | null;
    }>(
      `SELECT id, original_filename, storage_key, mime_type, extracted_text
       FROM file_uploads
       WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE`,
      [fileId, userId],
    );

    if (res.rowCount === 0) {
      throw new NotFoundException('Uploaded file not found');
    }
    const row = res.rows[0];
    let buffer: Buffer;

    if (this.s3Client) {
      const obj = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: row.storage_key }),
      );
      const bytes = await obj.Body!.transformToByteArray();
      buffer = Buffer.from(bytes);
    } else {
      const fullPath = path.join(this.localRoot, row.storage_key);
      buffer = fs.existsSync(fullPath) ? fs.readFileSync(fullPath) : Buffer.alloc(0);
    }

    return {
      id: row.id,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      extractedText: row.extracted_text,
      buffer,
    };
  }

  async listUserFiles(userId: string) {
    const res = await this.db.query(
      `SELECT id, original_filename, mime_type, size_bytes, purpose, created_at
       FROM file_uploads
       WHERE user_id = $1 AND is_deleted = FALSE
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    );
    return res.rows.map((r) => ({
      ...r,
      size_bytes: Number(r.size_bytes),
    }));
  }

  async deleteUserFile(userId: string, fileId: string) {
    const res = await this.db.query(
      'UPDATE file_uploads SET is_deleted = TRUE WHERE id = $1 AND user_id = $2 RETURNING id',
      [fileId, userId],
    );
    if (res.rowCount === 0) throw new NotFoundException('File not found');
    return { deleted: true };
  }

  private extractReadableText(buffer: Buffer, mimeType: string): string | null {
    if (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json'
    ) {
      return buffer.toString('utf8').slice(0, 60_000);
    }
    if (mimeType === 'application/pdf') {
      // Lightweight text extraction for uncompressed PDF text streams
      const raw = buffer.toString('latin1');
      const matches = raw.match(/\(([^()]{2,200})\)/g);
      if (matches && matches.length > 0) {
        return matches
          .map((m) => m.slice(1, -1))
          .join(' ')
          .replace(/[^\x20-\x7E\u0D80-\u0DFF\n]/g, ' ')
          .slice(0, 60_000);
      }
    }
    return null;
  }
}

@ApiTags('Secure File Uploads & Document Storage')
@ApiBearerAuth()
@Controller('files')
export class StorageController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload an attachment, image, or document (S3-compatible + SHA-256 verified)' })
  async upload(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.storage.uploadBase64File(user.id, body);
  }

  @Get()
  @ApiOperation({ summary: 'List authenticated user uploaded files' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.storage.listUserFiles(user.id);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.storage.deleteUserFile(user.id, id);
  }
}

@Module({
  providers: [StorageService],
  controllers: [StorageController],
  exports: [StorageService],
})
export class StorageModule {}
