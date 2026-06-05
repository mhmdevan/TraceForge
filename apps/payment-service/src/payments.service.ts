import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PaymentFaultConfig } from "@traceforge/config";
import {
  PaymentAuthorizationRequest,
  PaymentAuthorizationResponse
} from "@traceforge/contracts";
import { Logger, createNoopLogger } from "@traceforge/logger";
import { ServiceTracer, createNoopServiceTracer } from "@traceforge/tracing";

const NORMAL_FAULTS: PaymentFaultConfig = {
  mode: "normal",
  delayMs: 0,
  errorRate: 0,
  timeoutRate: 0,
  timeoutMs: 10000
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly logger: Logger = createNoopLogger(),
    private readonly tracer: ServiceTracer = createNoopServiceTracer(),
    private readonly faults: PaymentFaultConfig = NORMAL_FAULTS,
    private readonly random: () => number = Math.random
  ) {}

  async authorize(
    request: PaymentAuthorizationRequest,
    simulatedDelayMs?: number
  ): Promise<PaymentAuthorizationResponse> {
    return this.tracer.withSpan(
      "payment.authorize",
      async () => {
        if (this.shouldInjectError()) {
          this.logger.error("payment.injected_error", {
            transaction_id: request.transactionId,
            user_id: request.userId,
            fault_mode: this.faults.mode
          });
          throw new InternalServerErrorException("injected payment failure");
        }

        const appliedDelayMs = this.resolveDelayMs(simulatedDelayMs);

        if (appliedDelayMs > 0) {
          await sleep(appliedDelayMs);
        }

        const status = request.amount <= 5000 ? "approved" : "declined";
        this.logger.info("payment.authorized", {
          transaction_id: request.transactionId,
          user_id: request.userId,
          amount: request.amount,
          currency: request.currency,
          payment_status: status,
          simulated_delay_ms: appliedDelayMs
        });

        return {
          transactionId: request.transactionId,
          status,
          providerReference: `pay_${request.transactionId}`,
          authorizedAt: new Date().toISOString()
        };
      },
      {
        attributes: {
          "payment.amount": request.amount,
          "payment.currency": request.currency,
          "traceforge.payment_fault_mode": this.faults.mode,
          "traceforge.simulated_payment_delay_ms": simulatedDelayMs
        }
      }
    );
  }

  private shouldInjectError(): boolean {
    return this.faults.mode === "error" || this.random() < this.faults.errorRate;
  }

  private shouldInjectTimeout(): boolean {
    return this.faults.mode === "timeout" || this.random() < this.faults.timeoutRate;
  }

  // Resolves how long the authorization should take. A timeout fault holds the
  // request long enough that the caller's client timeout fires; otherwise the
  // largest of the per-request delay header and the configured slow delay applies.
  private resolveDelayMs(simulatedDelayMs?: number): number {
    if (this.shouldInjectTimeout()) {
      return this.faults.timeoutMs;
    }

    return Math.max(simulatedDelayMs ?? 0, this.faults.delayMs);
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
