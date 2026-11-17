import { BusinessException } from '@nextech/service-kit';

// Catalog mã lỗi catalog — khớp NT.CATALOG API_Spec §4. Thêm mã: sửa cả hai nơi trong cùng commit.
export const CAT_ERROR = {
  OUT_OF_STOCK: 'NT-CAT-1001',
  PRODUCT_UNAVAILABLE: 'NT-CAT-1002',
  RESERVATION_RELEASED: 'NT-CAT-1003',
  RESERVATION_NOT_FOUND: 'NT-CAT-1004',
  PRODUCT_NOT_FOUND: 'NT-CAT-1005',
  REVIEW_NOT_PURCHASED: 'NT-CAT-1006',
  REVIEW_EXISTS: 'NT-CAT-1007',
  ALERT_EXISTS: 'NT-CAT-1008',
  ALERT_NOT_FOUND: 'NT-CAT-1009',
  IMAGE_REQUIRED: 'NT-CAT-1010',
} as const;

// Dùng chung cho product và admin-product: câu chữ giữ nguyên be/ (NotFoundException), thêm mã NT-CAT-1005
export const productNotFound = () =>
  new BusinessException(
    404,
    CAT_ERROR.PRODUCT_NOT_FOUND,
    'Không tìm thấy sản phẩm',
  );
