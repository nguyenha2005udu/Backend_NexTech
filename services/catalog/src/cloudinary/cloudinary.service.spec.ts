import { UpstreamError } from '@nextech/service-kit';
import { v2 as cloudinary } from 'cloudinary';
import { Writable } from 'node:stream';
import { CloudinaryService } from './cloudinary.service';

// Hành vi gốc: be/src/cloudinary/Cloudinary.service.ts. Thêm do tách service (API_Spec §3, reliability-standard):
// timeout 5 s; upload lỗi → 503, quá giờ → 504 qua UpstreamError (không trả chi tiết Cloudinary về client);
// xoá ảnh lỗi hoặc quá giờ thì bỏ qua như be/.

jest.mock('cloudinary', () => ({
  v2: { uploader: { upload_stream: jest.fn(), destroy: jest.fn() } },
}));

const uploader = cloudinary.uploader as unknown as {
  upload_stream: jest.Mock;
  destroy: jest.Mock;
};

const file = { buffer: Buffer.from('img') } as Express.Multer.File;

/** Stream nhận dữ liệu rồi gọi callback theo kịch bản; `null` = không bao giờ trả lời */
function uploadStream(
  outcome: { error?: unknown; result?: unknown } | null,
): jest.Mock {
  return uploader.upload_stream.mockImplementation(
    (_opts: unknown, cb: (e: unknown, r?: unknown) => void) =>
      new Writable({
        write(_chunk, _enc, next) {
          next();
        },
        final(done) {
          if (outcome) cb(outcome.error, outcome.result);
          done();
        },
      }),
  );
}

describe('CloudinaryService', () => {
  const TIMEOUT = 50;
  let service: CloudinaryService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new CloudinaryService(TIMEOUT);
  });

  describe('uploadImage', () => {
    it('thành công → trả kết quả Cloudinary, đúng folder', async () => {
      uploadStream({ result: { secure_url: 'https://x', public_id: 'p/1' } });

      await expect(service.uploadImage(file, 'products/abc')).resolves.toEqual({
        secure_url: 'https://x',
        public_id: 'p/1',
      });
      expect(uploader.upload_stream).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'products/abc' }),
        expect.any(Function),
      );
    });

    it('Cloudinary báo lỗi (vd key `disabled`) → 503 NT-GEN-0503, không lộ chi tiết', async () => {
      uploadStream({
        error: { message: 'Invalid api_key disabled', http_code: 401 },
      });

      const err = (await service
        .uploadImage(file)
        .catch((e: unknown) => e)) as UpstreamError;
      expect(err).toBeInstanceOf(UpstreamError);
      expect(err.getStatus()).toBe(503);
      expect(err.code).toBe('NT-GEN-0503');
      expect(err.message).not.toContain('api_key');
      expect(err.reason).toContain('Invalid api_key disabled');
    });

    it('quá thời gian → 504 NT-GEN-0504', async () => {
      uploadStream(null);

      const started = Date.now();
      const err = (await service
        .uploadImage(file)
        .catch((e: unknown) => e)) as UpstreamError;
      expect(err).toBeInstanceOf(UpstreamError);
      expect(err.getStatus()).toBe(504);
      expect(err.code).toBe('NT-GEN-0504');
      expect(Date.now() - started).toBeLessThan(TIMEOUT * 10);
    });
  });

  describe('deleteImage', () => {
    it('public_id rỗng → không gọi Cloudinary', async () => {
      await service.deleteImage(null);
      await service.deleteImage(undefined);
      await service.deleteImage('');
      expect(uploader.destroy).not.toHaveBeenCalled();
    });

    it('gọi destroy đúng public_id', async () => {
      uploader.destroy.mockResolvedValue({ result: 'ok' });
      await service.deleteImage('products/1/a');
      expect(uploader.destroy).toHaveBeenCalledWith('products/1/a');
    });

    it('lỗi → bỏ qua, không ném (giữ be/)', async () => {
      uploader.destroy.mockRejectedValue(new Error('down'));
      await expect(service.deleteImage('p')).resolves.toBeUndefined();
    });

    it('quá thời gian → bỏ qua, trả về sau khoảng timeout', async () => {
      uploader.destroy.mockReturnValue(new Promise(() => undefined));
      const started = Date.now();
      await expect(service.deleteImage('p')).resolves.toBeUndefined();
      expect(Date.now() - started).toBeLessThan(TIMEOUT * 10);
    });
  });
});
