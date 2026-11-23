import { BusinessException } from '@nextech/service-kit';

// Catalog mã lỗi assistant — khớp design/ASSISTANT/README.md §6. Thêm mã: sửa cả hai nơi trong cùng commit.
// Thông báo không chứa tên biến cấu hình, tên model hay body từ FPT; chi tiết chỉ ghi log.
export const AST_ERROR = {
  CONVERSATION_NOT_FOUND: 'NT-AST-1001',
  FORBIDDEN: 'NT-AST-1002',
  AI_NOT_CONFIGURED: 'NT-AST-1003',
  AI_UNAVAILABLE: 'NT-AST-1004',
  AI_TIMEOUT: 'NT-AST-1005',
  CATALOG_UNAVAILABLE: 'NT-AST-1006',
} as const;

export const conversationNotFound = () =>
  new BusinessException(
    404,
    AST_ERROR.CONVERSATION_NOT_FOUND,
    'Không tìm thấy cuộc hội thoại',
  );

// BR-14. Câu chữ giữ nguyên source cũ users/conversation/conversation.service.ts
export const conversationForbidden = () =>
  new BusinessException(
    403,
    AST_ERROR.FORBIDDEN,
    'Bạn không có quyền truy cập cuộc hội thoại này',
  );

export const aiNotConfigured = () =>
  new BusinessException(
    503,
    AST_ERROR.AI_NOT_CONFIGURED,
    'Trợ lý AI chưa sẵn sàng',
  );

// BR-16
export const aiUnavailable = () =>
  new BusinessException(
    503,
    AST_ERROR.AI_UNAVAILABLE,
    'Trợ lý AI tạm thời không phản hồi được, vui lòng thử lại',
  );

// BR-16
export const aiTimeout = () =>
  new BusinessException(
    504,
    AST_ERROR.AI_TIMEOUT,
    'Trợ lý AI phản hồi quá lâu, vui lòng thử lại',
  );

// BR-13
export const catalogUnavailable = () =>
  new BusinessException(
    503,
    AST_ERROR.CATALOG_UNAVAILABLE,
    'Chưa tra cứu được sản phẩm, vui lòng thử lại',
  );
