import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Non authentifié" }, 401);
    }

    // Client lié à l'utilisateur connecté (via son JWT) pour l'identifier
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) return json({ error: "Session invalide" }, 401);

    // Client service role pour lire/écrire subscriptions (RLS bypass)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: ent } = await admin
      .from("entreprises")
      .select("id, nom, email")
      .eq("user_id", user.id)
      .single();
    if (!ent) return json({ error: "Entreprise introuvable" }, 404);

    const { origin } = await req.json().catch(() => ({ origin: "" }));
    const baseUrl = origin || Deno.env.get("APP_URL") || "";

    // Réutilise le customer Stripe existant ou en crée un
    const { data: sub } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("entreprise_id", ent.id)
      .single();

    let customerId = sub?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: ent.email || user.email,
        name: ent.nom,
        metadata: { entreprise_id: ent.id },
      });
      customerId = customer.id;
      await admin.from("subscriptions")
        .upsert({ entreprise_id: ent.id, stripe_customer_id: customerId }, { onConflict: "entreprise_id" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: ent.id,
      line_items: [{ price: Deno.env.get("STRIPE_PRICE_PRO")!, quantity: 1 }],
      subscription_data: { metadata: { entreprise_id: ent.id } },
      success_url: `${baseUrl}/app?checkout=success`,
      cancel_url: `${baseUrl}/app?checkout=cancel`,
      allow_promotion_codes: true,
      locale: "fr",
    });

    return json({ url: session.url });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
