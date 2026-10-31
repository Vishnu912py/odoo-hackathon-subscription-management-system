import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type Payment, type Invoice } from '../../generated/prisma/client.js';

const Decimal = Prisma.Decimal;

export interface ApplyPaymentParams {
  invoiceId: string;
  recordedById?: string | null;
  idempotencyKey: string;
  scope?: string;
  method: string;
  amount: string | number | Prisma.Decimal;
  paymentDate: Date | string;
  note?: string | null;
  expectedVersion?: number;
  today?: string;
  requestPayload?: unknown;
}

export interface ApplyPaymentResult {
  payment: Payment;
  invoice: Invoice;
  isReplay: boolean;
}

export class PaymentPersistenceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string
  ) {
    super(message);
    this.name = 'PaymentPersistenceError';
  }
}

function canonicalString(val: unknown): string {
  if (Array.isArray(val)) return `[${val.map(canonicalString).join(',')}]`;
  if (val && typeof val === 'object') {
    return `{${Object.entries(val).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalString(v)}`).join(',')}}`;
  }
  return JSON.stringify(val);
}

/**
 * Transactional Payment Allocation Service
 * 
 * Enforces:
 * 1. Payment idempotency resolution before version/state validation (allowing successful retries on changed invoices).
 * 2. Strict rejection of conflicting idempotency keys with different payloads.
 * 3. Row-level locking on invoice row (SELECT FOR UPDATE) to prevent concurrent balance anomalies.
 * 4. Optimistic concurrency check (expectedVersion).
 * 5. Rejection of payments on non-CONFIRMED invoices.
 * 6. Strict rejection of overpayments (amount > invoice.total - invoice.amountPaid).
 * 7. Atomic payment creation, invoice balance/status update, and idempotency persistence.
 */
export async function applyInvoicePayment(
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  params: ApplyPaymentParams
): Promise<ApplyPaymentResult> {
  const {
    invoiceId,
    recordedById = null,
    idempotencyKey,
    scope = `invoice:${invoiceId}:payment`,
    method,
    amount: amountRaw,
    paymentDate: paymentDateRaw,
    note = null,
    expectedVersion,
    today = new Date().toISOString().split('T')[0],
    requestPayload,
  } = params;

  const amount = new Decimal(amountRaw.toString());
  if (!amount.gt(0)) {
    throw new PaymentPersistenceError(422, 'VALIDATION_ERROR', 'Payment amount must be strictly greater than zero.');
  }

  const paymentDate = new Date(paymentDateRaw);
  const paymentDateStr = paymentDate.toISOString().split('T')[0];
  if (paymentDateStr! > today!) {
    throw new PaymentPersistenceError(422, 'VALIDATION_ERROR', 'Payment date cannot be in the future.');
  }

  const payloadToHash = requestPayload ?? { amount: amount.toFixed(2), method, paymentDate: paymentDateStr, note };
  const calculatedHash = createHash('sha256').update(canonicalString(payloadToHash)).digest('hex');

  const executeInTransaction = async (tx: Prisma.TransactionClient): Promise<ApplyPaymentResult> => {
    // 1. Transaction-scoped advisory lock for the idempotency key
    const lockKey = `${scope}:${idempotencyKey}`;
    const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
    `;
    if (!lock?.acquired) {
      throw new PaymentPersistenceError(409, 'REQUEST_IN_PROGRESS', 'A payment with this idempotency key is already in progress.');
    }

    // 2. Check Idempotency Record first
    const existingIdem = await tx.idempotencyRecord.findUnique({
      where: {
        scope_idempotencyKey: {
          scope,
          idempotencyKey,
        },
      },
    });

    if (existingIdem) {
      if (existingIdem.requestHash !== calculatedHash) {
        throw new PaymentPersistenceError(409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was previously used with different request contents.');
      }

      // Find the associated payment and current invoice
      const existingPayment = await tx.payment.findUnique({
        where: { idempotencyKey },
      });
      const currentInvoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
      });

      if (!existingPayment || !currentInvoice) {
        throw new PaymentPersistenceError(500, 'INTERNAL_ERROR', 'Idempotency record exists but associated payment or invoice was not found.');
      }

      return {
        payment: existingPayment,
        invoice: currentInvoice,
        isReplay: true,
      };
    }

    // 3. Acquire row-level lock on the target invoice
    // Using UPDATE ... increment: 0 to acquire row lock in Prisma
    const lockResult = await tx.invoice.updateMany({
      where: { id: invoiceId },
      data: { version: { increment: 0 } },
    });

    if (lockResult.count === 0) {
      throw new PaymentPersistenceError(404, 'NOT_FOUND', `Invoice ${invoiceId} not found.`);
    }

    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });

    // 4. Optimistic concurrency check (expectedVersion)
    if (expectedVersion !== undefined && invoice.version !== expectedVersion) {
      throw new PaymentPersistenceError(412, 'VERSION_CONFLICT', `Invoice version conflict: expected version ${expectedVersion}, but found ${invoice.version}. Refresh invoice before retrying.`);
    }

    // 5. State validation
    if (invoice.status !== 'CONFIRMED') {
      throw new PaymentPersistenceError(409, 'INVALID_TRANSITION', `Payments require a CONFIRMED invoice; current status is ${invoice.status}.`);
    }

    // 6. Overpayment check
    const currentPaid = new Decimal(invoice.amountPaid.toString());
    const totalDue = new Decimal(invoice.total.toString());
    const outstanding = totalDue.minus(currentPaid);

    if (amount.gt(outstanding)) {
      throw new PaymentPersistenceError(409, 'PAYMENT_EXCEEDS_BALANCE', `Payment amount (₹${amount.toFixed(2)}) exceeds outstanding balance (₹${outstanding.toFixed(2)}).`);
    }

    const newAmountPaid = currentPaid.plus(amount);
    const newStatus = newAmountPaid.equals(totalDue) ? 'PAID' : 'CONFIRMED';

    // 7. Atomic database mutations
    const createdPayment = await tx.payment.create({
      data: {
        invoiceId,
        recordedById,
        idempotencyKey,
        method,
        amount,
        paymentDate,
        note,
      },
    });

    const updatedInvoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: newAmountPaid,
        status: newStatus,
        version: { increment: 1 },
      },
    });

    // 8. Persist Idempotency Record
    const resultPayload = {
      paymentId: createdPayment.id,
      invoiceId: updatedInvoice.id,
      amount: createdPayment.amount.toFixed(2),
      status: updatedInvoice.status,
      version: updatedInvoice.version,
    };

    await tx.idempotencyRecord.create({
      data: {
        scope,
        idempotencyKey,
        requestHash: calculatedHash,
        statusCode: 201,
        responseBody: resultPayload as Prisma.InputJsonObject,
      },
    });

    return {
      payment: createdPayment,
      invoice: updatedInvoice,
      isReplay: false,
    };
  };

  if ('$transaction' in prismaOrTx) {
    return prismaOrTx.$transaction(executeInTransaction, { isolationLevel: 'ReadCommitted' });
  } else {
    return executeInTransaction(prismaOrTx);
  }
}
