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

// Checkout (NT.CHECKOUT_SAGA API_Spec §1). Câu chữ giữ nguyên be/src/users/order/order.service.ts checkout.
export const cartEmpty = () =>
  new BusinessException(400, ORD_ERROR.CART_EMPTY, 'Giỏ hàng trống');

export const invalidAddress = () =>
  new BusinessException(
    400,
    ORD_ERROR.INVALID_ADDRESS,
    'Địa chỉ giao hàng không hợp lệ',
  );

export const cartItemGone = () =>
  new BusinessException(
    400,
    ORD_ERROR.CART_ITEM_GONE,
    'Có sản phẩm đã chọn không còn trong giỏ hàng, vui lòng tải lại giỏ',
  );

export const productUnavailable = (nameOrId: string) =>
  new BusinessException(
    400,
    ORD_ERROR.PRODUCT_UNAVAILABLE,
    `Sản phẩm "${nameOrId}" hiện không khả dụng`,
  );

// Saga (NT.ORDER API_Spec §3): vi phạm ux_orders_cart_processing
export const orderInProgress = () =>
  new BusinessException(
    409,
    ORD_ERROR.ORDER_IN_PROGRESS,
    'Đơn hàng khác đang được xử lý, vui lòng đợi',
  );

// Huỷ đơn (NT.CHECKOUT_SAGA API_Spec §2, BR-06). Câu chữ giữ nguyên be/src/users/order/order.service.ts cancel
export const cannotCancel = () =>
  new BusinessException(
    400,
    ORD_ERROR.CANNOT_CANCEL,
    'Đơn hàng đã được xử lý, không thể huỷ',
  );

// Catalog mã lỗi thanh toán — khớp NT.PAYMENT API_Spec §4 (giữ tiền tố PAY). Câu chữ giữ nguyên
// be/src/users/payment, be/src/admin/payment; riêng 1006 (503) không đưa lỗi của PayOS ra client
// (security-policy §5), 1010 mới do hạn giữ hàng (BR-19).
export const PAY_ERROR = {
  NOT_FOUND: 'NT-PAY-1001',
  ORDER_NOT_PAYABLE: 'NT-PAY-1002',
  ALREADY_EXISTS: 'NT-PAY-1003',
  INVALID_WEBHOOK: 'NT-PAY-1004',
  AMOUNT_MISMATCH: 'NT-PAY-1005',
  PROVIDER_FAILED: 'NT-PAY-1006',
  FORBIDDEN: 'NT-PAY-1007',
  COD_ONLY: 'NT-PAY-1008',
  INVALID_STATE: 'NT-PAY-1009',
  EXPIRED: 'NT-PAY-1010',
} as const;

export const paymentOrderNotFound = () =>
  new BusinessException(404, PAY_ERROR.NOT_FOUND, 'Không tìm thấy đơn hàng');

export const paymentNotFound = () =>
  new BusinessException(
    404,
    PAY_ERROR.NOT_FOUND,
    'Không tìm thấy giao dịch thanh toán',
  );

export const orderNotPayable = (status: string) =>
  new BusinessException(
    400,
    PAY_ERROR.ORDER_NOT_PAYABLE,
    `Đơn hàng đang ở trạng thái "${status}", không thể tạo giao dịch thanh toán mới`,
  );

export const paymentExists = () =>
  new BusinessException(
    409,
    PAY_ERROR.ALREADY_EXISTS,
    'Đơn hàng này đã có giao dịch thanh toán, vui lòng kiểm tra trạng thái thay vì tạo mới',
  );

export const invalidWebhook = () =>
  new BusinessException(400, PAY_ERROR.INVALID_WEBHOOK, 'Webhook không hợp lệ');

export const amountMismatch = (
  paid: number | string,
  amount: number | string,
) =>
  new BusinessException(
    400,
    PAY_ERROR.AMOUNT_MISMATCH,
    `Số tiền thanh toán (${paid}) không khớp số tiền giao dịch (${amount})`,
  );

export const providerFailed = () =>
  new BusinessException(
    503,
    PAY_ERROR.PROVIDER_FAILED,
    'Lỗi tạo link thanh toán PayOS, vui lòng thử lại',
  );

export const paymentForbidden = () =>
  new BusinessException(
    403,
    PAY_ERROR.FORBIDDEN,
    'Bạn không có quyền xem giao dịch này',
  );

export const codOnly = () =>
  new BusinessException(
    400,
    PAY_ERROR.COD_ONLY,
    'Chỉ áp dụng xác nhận cho giao dịch COD',
  );

// Hai câu của be/: markSuccess ("chuyển sang success"), confirmCod ("xác nhận thu tiền")
export const invalidPaymentState = (status: string, action: string) =>
  new BusinessException(
    400,
    PAY_ERROR.INVALID_STATE,
    `Giao dịch đang ở trạng thái "${status}", không thể ${action}`,
  );

export const paymentExpired = () =>
  new BusinessException(
    400,
    PAY_ERROR.EXPIRED,
    'Đơn hàng đã hết hạn thanh toán',
  );
