export function errorMessage(error: unknown, fallback = "This step failed. Please try again."): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return fallback;
}
