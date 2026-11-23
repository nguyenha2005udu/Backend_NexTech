FROM node:22-alpine
WORKDIR /app
COPY ai-mock.mjs ./
ENV AI_MOCK_PORT=4020
EXPOSE 4020
USER node
CMD ["node", "ai-mock.mjs"]
