import { ZuploContext, ZuploRequest } from "@zuplo/runtime";
import { supabase } from "../modules/supabase";

export default async function (request: ZuploRequest, context: ZuploContext) {
  try {
    const { wallet_address, document_data } = await request.json();

    if (!wallet_address || !document_data) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: wallet_address or document_data" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // 1. Check ledger for available balance
    const { data: ledger, error: ledgerError } = await supabase
      .from("wallet_ledger")
      .select("balance")
      .eq("wallet_address", wallet_address)
      .single();

    if (ledgerError || !ledger || ledger.balance < 1) {
      return new Response(
        JSON.stringify({ error: "Insufficient payment balance. Please fund your x402 wallet." }),
        { status: 402, headers: { "content-type": "application/json" } }
      );
    }

    // 2. Deduct 1 credit balance via rpc debit function
    const { data: debitSuccess, error: debitError } = await supabase
      .rpc("debit_wallet_balance", { 
        p_wallet: wallet_address, 
        p_amount: 1 
      });

    if (debitError || !debitSuccess) {
      return new Response(
        JSON.stringify({ error: "Payment processing failed." }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    // 3. Perform stateless payload mock parsing execution
    const parsedOutput = {
      status: "success",
      timestamp: new Date().toISOString(),
      extracted_meta: {
        processed_bytes: Buffer.byteLength(JSON.stringify(document_data)),
        agent_exec_code: "x402-parse-complete"
      }
    };

    return new Response(
      JSON.stringify(parsedOutput),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Invalid request payload layout" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }
}