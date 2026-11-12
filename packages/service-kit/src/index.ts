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
export { GEN_ERROR } from './errors/codes';

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

export { HealthModule, type HealthModuleOptions } from './health/health.module';
export {
  typeOrmHealthCheck,
  redisHealthCheck,
  type HealthCheck,
} from './health/checks';
