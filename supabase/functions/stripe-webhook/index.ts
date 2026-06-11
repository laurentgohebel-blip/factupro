import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

// ⚠️ Déployer avec "Verify JWT" DÉSACTIVÉ (Stripe appelle sans token).

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const PRO_STATUSES = ["active", "trialing", "past_due"];

serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Signature manquante", { status: 400 });

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = await stripe.webhooks.constructEventAsync(body, sig, WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`Signature invalide : ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.subscription) {
          await syncSub(s.subscription as string, s.client_reference_id, s.customer as string);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await syncSub(sub.id, sub.metadata?.entreprise_id ?? null, sub.customer as string);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const inv = event.data.object as Stripe.Invoice;
        if (inv.subscription) {
          await syncSub(inv.subscription as string, null, inv.customer as string);
        }
        break;
      }
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// Récupère l'abonnement FRAIS depuis Stripe (statut réel à jour) puis met à
// jour la base. On ne se fie jamais au statut figé dans le payload de l'événement.
async function syncSub(subId: string, entrepriseHint: string | null, customerHint: string | null) {
  const sub = await stripe.subscriptions.retrieve(subId);
  const customerId = (sub.customer as string) || customerHint || "";
  const entrepriseId = entrepriseHint
    || (sub.metadata?.entreprise_id ?? null)
    || await entrepriseIdFromCustomer(customerId);
  if (!entrepriseId) return;
  await upsertSub(entrepriseId, sub, customerId);
}

async function upsertSub(entrepriseId: string, sub: Stripe.Subscription, customerId: string) {
  const isDeleted = sub.status === "canceled" || sub.status === "unpaid";
  const plan = !isDeleted && PRO_STATUSES.includes(sub.status) ? "pro" : "free";

  const cpeUnix = (sub as any).current_period_end
    ?? (sub as any).items?.data?.[0]?.current_period_end
    ?? null;
  let periodEnd: string | null = null;
  if (cpeUnix) { const d = new Date(cpeUnix * 1000); if (!isNaN(d.getTime())) periodEnd = d.toISOString(); }

  const { error } = await admin.from("subscriptions").upsert({
    entreprise_id: entrepriseId,
    plan,
    status: sub.status,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd,
    updated_at: new Date().toISOString(),
  }, { onConflict: "entreprise_id" });
  if (error) throw error;
}

async function entrepriseIdFromCustomer(customerId: string): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await admin
    .from("subscriptions").select("entreprise_id")
    .eq("stripe_customer_id", customerId).maybeSingle();
  return data?.entreprise_id ?? null;
}
