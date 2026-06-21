import { ZuploContext, ZuploRequest, CustomPolicyOptionsContext } from "@zuplo/runtime";

export default async function policy(
  request: ZuploRequest,
  context: ZuploContext,
  options: CustomPolicyOptionsContext,
  policyName: string
) {
  const response = await context.next();

  // Create isolated metadata block for compliance tracking
  const auditLog = {
    timestamp: new Date().toISOString(),
    walletHash: request.headers.get("x-agent-wallet")?.slice(0, 10) + "...",
    billing: context.custom.billingType || "unknown",
    status: response.status,
    egressSize: response.headers.get("content-length") || "0"
  };

  // Log clean performance stats strictly while blocking real data fields from stdout
  context.log.info(JSON.stringify(auditLog));

  return response;
}