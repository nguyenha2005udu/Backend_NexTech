// Chép từ be/src/cloudinary/Cloudinary.service.ts. Đổi do tách service (NT.CATALOG API_Spec §3, reliability-standard):
// - Mỗi lời gọi có timeout (5 s, Component_Class_Design §2).
// - Upload lỗi → 503, quá giờ → 504 qua UpstreamError. be/ để lỗi thô của Cloudinary đi ra thành 500.
//   Chi tiết lỗi chỉ ghi log (security-policy §5).
// - Xoá ảnh: lỗi hoặc quá giờ đều bỏ qua như be/, có ghi log.
import { Logger } from '@nestjs/common';
import { UpstreamError } from '@nextech/service-kit';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';

const TARGET = 'cloudinary';

class CloudinaryTimeout extends Error {}

export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly timeoutMs: number) {}

  /** Upload 1 ảnh (buffer từ multer memoryStorage) lên Cloudinary */
  async uploadImage(
    file: Express.Multer.File,
    folder = 'products',
  ): Promise<UploadApiResponse> {
    const upload = new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder },
        (error, result) => {
          if (error || !result) return reject(toError(error));
          resolve(result);
        },
      );
      Readable.from(file.buffer).pipe(uploadStream);
    });

    try {
      return await this.withTimeout(upload);
    } catch (e) {
      if (e instanceof CloudinaryTimeout) {
        throw new UpstreamError(TARGET, e.message, 'unknown', 504);
      }
      throw new UpstreamError(TARGET, (e as Error).message, 'unknown', 503);
    }
  }

  /** Xoá 1 ảnh trên Cloudinary theo public_id. Không throw nếu public_id rỗng/không tồn tại */
  async deleteImage(publicId: string | null | undefined): Promise<void> {
    if (!publicId) return;
    try {
      await this.withTimeout(cloudinary.uploader.destroy(publicId));
    } catch (e) {
      // Không chặn luồng chính nếu xoá trên Cloudinary thất bại (vd: đã bị xoá trước đó)
      this.logger.warn(
        `Xoá ảnh Cloudinary ${publicId} lỗi: ${(e as Error).message}`,
      );
    }
  }

  // SDK Cloudinary tự gọi HTTP, không đi qua ResilientHttpClient → tự giới hạn thời gian ở đây
  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new CloudinaryTimeout(`quá ${this.timeoutMs} ms`)),
        this.timeoutMs,
      );
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }
}

// Cloudinary trả lỗi dạng object `{ message, http_code }`, không phải Error
function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  const message = (error as { message?: unknown } | undefined)?.message;
  return new Error(typeof message === 'string' ? message : 'Upload thất bại');
}
