import { proxyExecutionRequest } from "~~/services/execution-proxy";

export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = proxyExecutionRequest;
export const POST = proxyExecutionRequest;
export const PATCH = proxyExecutionRequest;
