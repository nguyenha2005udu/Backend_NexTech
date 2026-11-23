// Điểm export công khai của @nextech/service-kit (API_Spec §1).
// Phần messaging (outbox, consumer) thêm ở T4.1.

export { bootstrapService, type BootstrapOptions } from './bootstrap';

export {
  ResilientHttpClient,
  type RequestOptions,
  type ResilientHttpClientOptions,
} from './http/resilient-http-client';
export {
  UpstreamError,
  UpstreamBusinessError,
  type UpstreamOutcome,
} from './http/errors';

export { BusinessException } from './errors/business.exception';
export { AllExceptionsFilter } from './errors/all-exceptions.filter';
export { codeForStatus, GEN_ERROR } from './errors/codes';

export {
  RequestContextMiddleware,
  requestContextMiddleware,
  currentRequestId,
  REQUEST_ID_HEADER,
} from './context/request-context';

export { InternalTokenGuard } from './auth/internal-token.guard';
export { GatewayUserGuard, type GatewayUser } from './auth/gateway-user.guard';
export { OptionalGatewayUserGuard } from './auth/optional-gateway-user.guard';
export { RolesGuard } from './auth/roles.guard';
export { CurrentUser, Roles, ROLES_KEY } from './auth/decorators';

export { ToBoolean } from './validation/to-boolean';

export { HealthModule, type HealthModuleOptions } from './health/health.module';
export {
  typeOrmHealthCheck,
  redisHealthCheck,
  rabbitHealthCheck,
  type HealthCheck,
} from './health/checks';

export {
  EVENTS_EXCHANGE,
  RETRY_EXCHANGE,
  DLQ_EXCHANGE,
  parseEnvelope,
  type EventEnvelope,
} from './messaging/envelope';
export { RetryableError, PoisonMessageError } from './messaging/errors';
export { messagingConfig, type MessagingConfig } from './messaging/config';
export { OutboxEvent } from './messaging/outbox.entity';
export { OutboxWriter } from './messaging/outbox-writer';
export {
  OutboxPublisher,
  type OutboxPublisherOptions,
  type PublisherChannel,
} from './messaging/outbox-publisher';
export {
  RabbitConsumer,
  type RabbitConsumerOptions,
  type ConsumeOutcome,
  type ConsumerChannel,
} from './messaging/rabbit-consumer';
