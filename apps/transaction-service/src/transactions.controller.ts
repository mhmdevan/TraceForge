import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post
} from "@nestjs/common";
import {
  assertCreateTransactionRequest,
  CreateTransactionResponse,
  TransactionHistoryResponse,
  TransactionResponse
} from "@traceforge/contracts";
import { TransactionsService } from "./transactions.service";

@Controller()
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post("transactions")
  async createTransaction(@Body() body: unknown): Promise<CreateTransactionResponse> {
    try {
      return await this.transactionsService.createTransaction(
        assertCreateTransactionRequest(body)
      );
    } catch (error) {
      if (error instanceof Error && /required|must be/.test(error.message)) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  @Get("transactions/:id")
  async getTransaction(@Param("id") id: string): Promise<TransactionResponse> {
    const transaction = await this.transactionsService.getTransaction(id);

    if (!transaction) {
      throw new NotFoundException(`Transaction ${id} was not found.`);
    }

    return transaction;
  }

  @Get("users/:userId/transactions")
  async getUserTransactions(
    @Param("userId") userId: string
  ): Promise<TransactionHistoryResponse> {
    if (!userId.trim()) {
      throw new BadRequestException("userId is required.");
    }

    return this.transactionsService.getUserTransactions(userId);
  }
}
