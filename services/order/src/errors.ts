import { BusinessException } from '@nextech/service-kit';

// Catalog mã lỗi order — khớp NT.ORDER API_Spec §3. Thêm mã: sửa cả hai nơi trong cùng commit.
export const ORD_ERROR = {
  CART_EMPTY: 'NT-ORD-1001',
  INVALID_ADDRESS: 'NT-ORD-1002',
  CART_ITEM_GONE: 'NT-ORD-1003',
  PRODUCT_UNAVAILABLE: 'NT-ORD-1004',
  OUT_OF_STOCK: 'NT-ORD-1005',
  ORDER_NOT_FOUND: 'NT-ORD-1006',
  INVALID_TRANSITION: 'NT-ORD-1007',
  CANNOT_CANCEL: 'NT-ORD-1008',
  ORDER_IN_PROGRESS: 'NT-ORD-1009',
  CART_ITEM_NOT_FOUND: 'NT-ORD-1010',
  PRODUCT_NOT_FOUND: 'NT-ORD-1011',
  ORDER_LOCKED: 'NT-ORD-1012',
} as const;

// Câu chữ giữ nguyên be/src/users/cart/cart.service.ts
export const productNotFound = () =>
  new BusinessException(
    404,
    ORD_ERROR.PRODUCT_NOT_FOUND,
    'Không tìm thấy sản phẩm',
  );

export const cartItemNotFound = () =>
  new BusinessException(
    404,
    ORD_ERROR.CART_ITEM_NOT_FOUND,
    'Không tìm thấy sản phẩm trong giỏ hàng',
  );

export const outOfStock = (name: string, stock: number) =>
  new BusinessException(
    400,
    ORD_ERROR.OUT_OF_STOCK,
    `Sản phẩm "${name}" chỉ còn ${stock} trong kho`,
  );

// Câu chữ giữ nguyên be/src/users/order, be/src/admin/order
export const orderNotFound = () =>
  new BusinessException(
    404,
    ORD_ERROR.ORDER_NOT_FOUND,
    'Không tìm thấy đơn hàng',
  );

// BR-06
export const invalidTransition = (from: string, to: string) =>
  new BusinessException(
    400,
    ORD_ERROR.INVALID_TRANSITION,
    `Không thể chuyển đơn từ "${from}" sang "${to}"`,
  );
