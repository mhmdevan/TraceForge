import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Post
} from "@nestjs/common";
import {
  assertCreateTransactionRequest,
  CreateTransactionResponse,
  TransactionHistoryResponse,
  TransactionResponse
} from "@traceforge/contracts";
import { TransactionsGatewayClient } from "./transactions.gateway-client";

@Controller()
export class TransactionsController {
  constructor(private readonly client: TransactionsGatewayClient) {}

  @Post("transactions")
  async createTransaction(@Body() body: unknown): Promise<CreateTransactionResponse> {
    try {
      return await this.client.createTransaction(assertCreateTransactionRequest(body));
    } catch (error) {
      throw mapGatewayError(error);
    }
  }

  @Get("transactions/:id")
  async getTransaction(@Param("id") id: string): Promise<TransactionResponse> {
    try {
      return await this.client.getTransaction(id);
    } catch (error) {
      throw mapGatewayError(error);
    }
  }

  @Get("users/:userId/transactions")
  async getUserTransactions(
    @Param("userId") userId: string
  ): Promise<TransactionHistoryResponse> {
    try {
      return await this.client.getUserTransactions(userId);
    } catch (error) {
      throw mapGatewayError(error);
    }
  }
}

function mapGatewayError(error: unknown): Error {
  if (error instanceof Error && /required|must be/.test(error.message)) {
    return new BadRequestException(error.message);
  }

  return new InternalServerErrorException(
    error instanceof Error ? error.message : "Transaction request failed."
  );
}
