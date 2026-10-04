import {
  ClarificationAnswerSchema,
  CreateExecutionSchema,
  IntentTextSchema,
  SubmissionSchema,
  WalletIdentitySchema,
} from "@9oob/schema";
import type { ExecutionService } from "./execution.service.js";
import { getBearerToken, requestRateBucket } from "../../shared/auth/auth.middleware.js";
import { ConfigurationError } from "../../shared/config/env.js";

export async function startExecution(request: Request, getNoobExecutionService: () => ExecutionService) {
  const body = await request.json().catch(() => null);
  const parsed = CreateExecutionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid intent request" }, { status: 400 });
  try {
    const service = getNoobExecutionService();
    if (!(await service.consumeStartRateLimit(requestRateBucket(request)))) {
      return Response.json(
        { error: "Too many intent requests. Try again in a minute." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    const result = await service.start(parsed.data.intent, parsed.data.accountId, parsed.data.evmAddress);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const missingConfig = error instanceof ConfigurationError;
    return Response.json(
      { error: missingConfig ? error.message : "Intent interpretation is temporarily unavailable" },
      { status: missingConfig ? 503 : 502 },
    );
  }
}

export async function readExecution(request: Request, id: string, getNoobExecutionService: () => ExecutionService) {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Invalid execution capability" }, { status: 401 });
  let state;
  try {
    state = await getNoobExecutionService().read(id, token);
  } catch {
    const execution = await getNoobExecutionService().get(id, token);
    state = execution ? { execution } : null;
  }
  return state
    ? Response.json(state, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "Execution not found" }, { status: 404 });
}

export async function reviseExecution(request: Request, id: string, getNoobExecutionService: () => ExecutionService) {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Invalid execution capability" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = IntentTextSchema.safeParse(body?.intent);
  if (!parsed.success) {
    return Response.json({ error: "Invalid intent" }, { status: 400 });
  }
  try {
    const service = getNoobExecutionService();
    if (!(await service.consumeStartRateLimit(requestRateBucket(request)))) {
      return Response.json(
        { error: "Too many intent requests. Try again in a minute." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    const execution = await service.revise(id, token, parsed.data);
    return execution
      ? Response.json({ execution }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "Execution can no longer be edited" }, { status: 409 });
  } catch {
    return Response.json({ error: "Intent interpretation is temporarily unavailable" }, { status: 502 });
  }
}

export async function clarifyExecution(request: Request, id: string, getService: () => ExecutionService) {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Invalid execution capability" }, { status: 401 });
  const parsed = ClarificationAnswerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid clarification reply" }, { status: 400 });
  try {
    const service = getService();
    if (!(await service.consumeStartRateLimit(requestRateBucket(request)))) {
      return Response.json(
        { error: "Too many intent requests. Try again in a minute." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    const execution = await service.clarify(id, token, parsed.data.answer, parsed.data.version);
    return execution
      ? Response.json({ execution }, { headers: { "Cache-Control": "no-store" } })
      : Response.json(
          { error: "This question has changed. Reload and try again, or edit the request." },
          { status: 409 },
        );
  } catch {
    return Response.json({ error: "Intent interpretation is temporarily unavailable" }, { status: 502 });
  }
}

export async function approveExecution(request: Request, id: string, getNoobExecutionService: () => ExecutionService) {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Invalid execution capability" }, { status: 401 });
  const execution = await getNoobExecutionService().approve(id, token);
  return execution
    ? Response.json({ execution }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "Execution is not awaiting approval" }, { status: 409 });
}

export async function connectExecutionWallet(request: Request, id: string, getService: () => ExecutionService) {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Invalid execution capability" }, { status: 401 });
  const parsed = WalletIdentitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid wallet identity" }, { status: 400 });
  const execution = await getService().connectWallet(id, token, parsed.data.accountId, parsed.data.evmAddress);
  return execution
    ? Response.json({ execution }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "Execution is not awaiting a wallet" }, { status: 409 });
}

export async function prepareExecution(request: Request, id: string, getNoobExecutionService: () => ExecutionService) {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Invalid execution capability" }, { status: 401 });
  try {
    const result = await getNoobExecutionService().prepare(id, token);
    return result
      ? Response.json(result, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "Execution is not ready for this step" }, { status: 409 });
  } catch {
    return Response.json({ error: "Execution step could not be prepared" }, { status: 502 });
  }
}

export async function submittedExecution(
  request: Request,
  id: string,
  getNoobExecutionService: () => ExecutionService,
) {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Invalid execution capability" }, { status: 401 });
  const parsed = SubmissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid transaction reference" }, { status: 400 });
  const execution = await getNoobExecutionService().registerSubmission(
    id,
    token,
    parsed.data.txHash,
    parsed.data.preparationVersion,
  );
  return execution
    ? Response.json({ execution }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "Execution is not awaiting a wallet signature" }, { status: 409 });
}

export async function cancelExecution(request: Request, id: string, getNoobExecutionService: () => ExecutionService) {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Invalid execution capability" }, { status: 401 });
  const execution = await getNoobExecutionService().cancel(id, token);
  return execution
    ? Response.json({ execution }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "This execution can no longer be cancelled" }, { status: 409 });
}
