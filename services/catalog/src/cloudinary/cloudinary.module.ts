// Chép từ be/src/cloudinary/{Cloudinary.module,Cloudinary.provider}.ts. Đổi: đọc cấu hình qua `cloudinary.*`
// của configuration.ts; CloudinaryService nhận timeout qua factory.
// CLOUDINARY_*=disabled vẫn khởi động được: cloudinary.config() chỉ lưu giá trị, không gọi mạng.
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { CloudinaryConfig } from '../config/configuration';
import { CloudinaryService } from './cloudinary.service';

@Module({
  providers: [
    {
      provide: CloudinaryService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const c = config.getOrThrow<CloudinaryConfig>('cloudinary');
        cloudinary.config({
          cloud_name: c.cloudName,
          api_key: c.apiKey,
          api_secret: c.apiSecret,
        });
        return new CloudinaryService(c.timeoutMs);
      },
    },
  ],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}
