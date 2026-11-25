import { BusinessException } from '@nextech/service-kit';

// Catalog mã lỗi notification — khớp NT.NOTIFICATION API_Spec §4. Thêm mã: sửa cả hai nơi trong cùng commit.
export const NTF_ERROR = {
  NOTIFICATION_NOT_FOUND: 'NT-NTF-1001',
} as const;

// Câu chữ giữ nguyên users/notification/notification.service.ts của source cũ. Không có hoặc của người khác (BR-17)
export const notificationNotFound = () =>
  new BusinessException(
    404,
    NTF_ERROR.NOTIFICATION_NOT_FOUND,
    'Không tìm thấy thông báo',
  );
