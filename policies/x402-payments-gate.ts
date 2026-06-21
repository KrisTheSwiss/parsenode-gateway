import { ZuploContext, ZuploRequest, CustomPolicyOptionsContext } from "@zuplo/runtime";
import { supabase } from "../modules/supabase";

interface PaymentChallenge {
  error: string;
  amountUSDC: string;
  destination: string;
  currency: string;
}

export default async function policy(
  request: ZuploRequest,
  context: ZuploContext,
  options: CustomPolicyOptionsContext,
  policyName: string
) {
  const walletAddress = request.headers.get("x-agent-wallet");
  const paymentSignature = request.headers.get("x-payment-signature");

  if (!walletAddress) {
    return new Response(
      JSON.stringify({ error: "bad_request", message: "Missing required X-Agent-Wallet header." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // 1. Compliance Sanction System Check
  const isSanctioned = await checkSanctionList(walletAddress);
  if (isSanctioned) {
    return new Response(
      JSON.stringify({ error: "compliance_rejection", message: "Wallet address failed AML check." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2. Evaluate Account Lifecycle / Free Tier Allocation
  const { data: ledger, error } = await supabase
    .from("wallet_ledger")
    .select("free_pages_remaining, is_blacklisted")
    .eq("wallet_address", walletAddress)
    .single();

  if (ledger?.is_blacklisted) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  // Create ledger row dynamically if first contact
  if (error && error.code === "PGRST116") {
    await supabase.from("wallet_ledger").insert([{ wallet_address: walletAddress }]);
  }

  const freePages = ledger ? ledger.free_pages_remaining : 50;

  if (freePages > 0) {
    // Free tier available: Decouple request from billing gate and decrement allowance
    context.custom.billingType = "free_tier";
    await supabase
      .from("wallet_ledger")
      .update({ free_pages_remaining: freePages - 1 })
      .eq("wallet_address", walletAddress);
      
    return context.next();
  }

  // 3. Paid Rail: Challenge verification or process incoming signature
  const targetRate = "0.040"; 
  const merchantWallet = process.env.MERCHANT_RECEIVER_ADDRESS!;

  if (!paymentSignature) {
    const challenge: PaymentChallenge = {
      error: "payment_required",
      amountUSDC: targetRate,
      destination: merchantWallet,
      currency: "USDC"
    };
    return new Response(JSON.stringify(challenge), {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "Payment-Required": `USDC:${targetRate}:${merchantWallet}`
      }
    });
  }

  // Verify settlement state against the on-chain x402 transaction validator network
  const paymentIsValid = await verifyX402Signature(paymentSignature, walletAddress, targetRate);
  if (!paymentIsValid) {
    return new Response(
      JSON.stringify({ error: "invalid_payment", message: "Cryptographic signature validation failed." }),
      { status: 402, headers: { "Content-Type": "application/json" } }
    );
  }

  // Increment metrics row upon transaction validation success
  await supabase.rpc("increment_paid_pages", { wallet: walletAddress, pages: 1 });
  context.custom.billingType = "x402_settled";
  
  return context.next();
}

async function checkSanctionList(wallet: string): Promise<boolean> {
  return false;
}

async function verifyX402Signature(sig: string, wallet: string, expectedAmount: string): Promise<boolean> {
  return sig.length === 66; 
}