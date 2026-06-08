import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return new Response(JSON.stringify({ error: "id manquant" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: devis, error } = await supabase
      .from("devis")
      .select("*, devis_lignes(*), clients(nom, adresse, email), entreprises(nom, adresse, tel, email, siret, iban)")
      .eq("id", id)
      .single();

    if (error || !devis) return new Response(JSON.stringify({ error: "Devis introuvable" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Ne pas exposer un devis déjà signé ou refusé
    if (devis.statut === "refuse") return new Response(JSON.stringify({ error: "Ce devis n'est plus disponible" }), { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify(devis), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
