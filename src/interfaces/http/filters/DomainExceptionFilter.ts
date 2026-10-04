import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";
import { DomainError, FailureCode } from "../../../domain/errors/DomainError";

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof DomainError) {
      let status = HttpStatus.BAD_REQUEST;

      switch (exception.code) {
        case FailureCode.InsufficientFunds:
          status = HttpStatus.UNPROCESSABLE_ENTITY; // 422
          break;
        case FailureCode.IdempotencyPayloadConflict:
        case FailureCode.TerminalStateConflict:
        case FailureCode.ReferenceAlreadyReversed:
          status = HttpStatus.CONFLICT; // 409
          break;
        case FailureCode.ReferenceNotFound:
          status = HttpStatus.NOT_FOUND; // 404
          break;
        case FailureCode.CurrencyMismatch:
        case FailureCode.InvalidAmountFormat:
          status = HttpStatus.BAD_REQUEST; // 400
          break;
        case FailureCode.InfrastructureFailure:
          status = HttpStatus.SERVICE_UNAVAILABLE;
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
      }

      return response.status(status).json({
        statusCode: status,
        error: exception.code,
        message: exception.message,
        timestamp: new Date().toISOString(),
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      return response
        .status(status)
        .json(
          typeof res === "object" ? res : { statusCode: status, message: res },
        );
    }

    console.error("==> [ERRO INTERNO NÃO TRATADO]:", exception);

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
      details:
        exception instanceof Error ? exception.message : String(exception),
    });
  }
}
