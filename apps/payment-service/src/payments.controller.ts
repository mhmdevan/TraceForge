import { BadRequestException, Body, Controller, Headers, Post } from "@nestjs/common";
import {
  PaymentAuthorizationRequest,
  PaymentAuthorizationResponse
} from "@traceforge/contracts";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("authorize")
  authorize(
    @Body() body: unknown,
    @Headers("x-simulated-payment-delay-ms") simulatedDelayMs?: string
  ): Promise<PaymentAuthorizationResponse> {
    return this.paymentsService.authorize(
      assertPaymentAuthorizationRequest(body),
      parseSimulatedDelay(simulatedDelayMs)
    );
  }
}

function assertPaymentAuthorizationRequest(value: unknown): PaymentAuthorizationRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("Request body must be an object.");
  }

  const body = value as Record<string, unknown>;

  if (typeof body.transactionId !== "string" || !body.transactionId.trim()) {
    throw new BadRequestException("transactionId is required.");
  }

  if (typeof body.userId !== "string" || !body.userId.trim()) {
    throw new BadRequestException("userId is required.");
  }

  if (
    typeof body.amount !== "number" ||
    !Number.isFinite(body.amount) ||
    body.amount <= 0
  ) {
    throw new BadRequestException("amount must be a positive number.");
  }

  if (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency)) {
    throw new BadRequestException("currency must be a 3-letter uppercase ISO code.");
  }

  return {
    transactionId: body.transactionId,
    userId: body.userId,
    amount: body.amount,
    currency: body.currency
  };
}

function parseSimulatedDelay(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const delayMs = Number(value);

  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5000) {
    throw new BadRequestException("x-simulated-payment-delay-ms must be 0-5000.");
  }

  return delayMs;
}
