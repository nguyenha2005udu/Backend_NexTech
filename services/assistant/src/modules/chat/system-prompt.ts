import type { Facets } from '../../clients/catalog.client';

// Chép nguyên từ source cũ users/chat/chat.service.ts: mô tả công cụ và hướng dẫn hệ thống.
// Đổi duy nhất tên cửa hàng "AI Shop" → "NexTech" (NT.ASSISTANT_CHAT API_Spec §4).

// Khai báo công cụ (định dạng OpenAI tools) để model tự gọi khi cần tra sản phẩm thật.
export const SEARCH_PRODUCTS_TOOL = {
  type: 'function',
  function: {
    name: 'search_products',
    description:
      'Tìm sản phẩm trong cửa hàng theo từ khoá tên, hãng, hoặc khoảng giá. Dùng khi khách hỏi về sản phẩm, nhu cầu, hoặc giá.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Từ khoá khớp TÊN sản phẩm — dùng cho tên/dòng máy cụ thể, ví dụ: "MacBook Air", "Galaxy S24". KHÔNG đặt loại sản phẩm chung chung ("đồng hồ", "laptop") vào đây — loại sản phẩm thì dùng tham số category.',
        },
        category: {
          type: 'string',
          description:
            'Tên danh mục, phải là MỘT trong các danh mục liệt kê ở hướng dẫn hệ thống, ví dụ: "Đồng hồ", "Laptop". Dùng khi khách hỏi theo loại sản phẩm.',
        },
        brand: { type: 'string', description: 'Hãng, ví dụ: "Dell", "Asus"' },
        minPrice: { type: 'number', description: 'Giá tối thiểu (VNĐ)' },
        maxPrice: { type: 'number', description: 'Giá tối đa (VNĐ)' },
      },
    },
  },
} as const;

export function buildSystemInstruction({ brands, categories }: Facets): string {
  return `Bạn là trợ lý mua sắm của "NexTech" - cửa hàng bán đồ điện tử (laptop, điện thoại, đồng hồ thông minh, phụ kiện...).
Nhiệm vụ: tư vấn và gợi ý sản phẩm phù hợp nhu cầu của khách.
Các hãng đang có: ${brands.length ? brands.join(', ') : 'đang cập nhật'}.
Các danh mục đang có: ${categories.length ? categories.map((c) => c.name).join(', ') : 'đang cập nhật'}.
QUY TẮC:
- Khi khách hỏi về sản phẩm, nhu cầu, hoặc giá: LUÔN dùng công cụ search_products để tra sản phẩm THẬT rồi tư vấn dựa trên kết quả.
- Khách hỏi theo LOẠI sản phẩm (kể cả gõ tiếng Việt không dấu, vd "dong ho deo tay") thì truyền tham số category với đúng tên danh mục ở trên; query chỉ dành cho tên/dòng máy cụ thể.
- KHÔNG bịa ra sản phẩm không có trong kết quả tra cứu.
- Trả lời NGẮN GỌN, thân thiện, bằng tiếng Việt. Giá tính bằng VNĐ.
- Nếu không tìm thấy sản phẩm phù hợp, gợi ý khách thử từ khoá/khoảng giá khác.`;
}
