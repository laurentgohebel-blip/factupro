import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { devisId, signatureDataUrl, statut } = await req.json();
    const isRefus = statut === "refuse";

    if (!devisId || (!isRefus && !signatureDataUrl)) {
      return new Response(JSON.stringify({ error: "devisId et signatureDataUrl requis" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const updates = isRefus
      ? { statut: "refuse" }
      : { signature_url: signatureDataUrl, statut: "accepte" };

    // .select() renvoie les lignes réellement modifiées → on peut vérifier
    // qu'au moins une ligne a bien été touchée.
    // On autorise la signature quel que soit le statut courant, SAUF si le
    // devis est déjà facturé (on ne réécrit pas un devis transformé).
    const { data, error } = await supabase
      .from("devis")
      .update(updates)
      .eq("id", devisId)
      .neq("statut", "facture")
      .select("id, statut, signature_url");

    if (error) throw error;

    if (!data || data.length === 0) {
      return new Response(JSON.stringify({
        error: "Ce devis a déjà été traité ou n'est plus disponible.",
        updated: 0,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, updated: data.length, devis: data[0] }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
