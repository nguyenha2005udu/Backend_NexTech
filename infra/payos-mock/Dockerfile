FROM node:22-alpine
WORKDIR /app
COPY payos-mock.mjs ./
ENV PAYOS_MOCK_PORT=4010
EXPOSE 4010
USER node
CMD ["node", "payos-mock.mjs"]
