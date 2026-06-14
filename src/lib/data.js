import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

// ─── Clients ───
export function useClients(entrepriseId) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!entrepriseId) return
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('entreprise_id', entrepriseId)
      .order('nom')
    setClients(data || [])
    setLoading(false)
  }, [entrepriseId])

  useEffect(() => { load() }, [load])

  async function addClient(client) {
    const { data, error } = await supabase
      .from('clients')
      .insert({ ...client, entreprise_id: entrepriseId })
      .select()
      .single()
    if (error) throw error
    setClients(prev => [...prev, data])
    return data
  }

  async function updateClient(id, updates) {
    const { data, error } = await supabase
      .from('clients')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setClients(prev => prev.map(c => c.id === id ? data : c))
    return data
  }

  async function deleteClient(id) {
    await supabase.from('clients').delete().eq('id', id)
    setClients(prev => prev.filter(c => c.id !== id))
  }

  return { clients, loading, addClient, updateClient, deleteClient, reload: load }
}

// ─── Catalogue ───
export function useCatalogue(entrepriseId) {
  const [catalogue, setCatalogue] = useState([])

  const load = useCallback(async () => {
    if (!entrepriseId) return
    const { data } = await supabase
      .from('catalogue')
      .select('*')
      .eq('entreprise_id', entrepriseId)
      .order('categorie, description')
    setCatalogue(data || [])
  }, [entrepriseId])

  useEffect(() => { load() }, [load])

  async function addItem(item) {
    const { data } = await supabase
      .from('catalogue')
      .insert({ ...item, entreprise_id: entrepriseId, actif: true })
      .select()
      .single()
    setCatalogue(prev => [...prev, data])
    return data
  }

  async function updateItem(id, updates) {
    const { data, error } = await supabase
      .from('catalogue')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setCatalogue(prev => prev.map(c => c.id === id ? data : c))
    return data
  }

  async function deleteItem(id) {
    await supabase.from('catalogue').delete().eq('id', id)
    setCatalogue(prev => prev.filter(c => c.id !== id))
  }

  return { catalogue, addItem, updateItem, deleteItem, reload: load }
}

// ─── Devis ───
export function useDevis(entrepriseId) {
  const [devis, setDevis] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!entrepriseId) return
    const { data } = await supabase
      .from('devis')
      .select(`*, devis_lignes(*)`)
      .eq('entreprise_id', entrepriseId)
      .order('date_devis', { ascending: false })
    setDevis(data || [])
    setLoading(false)
  }, [entrepriseId])

  useEffect(() => { load() }, [load])

  async function addDevis(devisData, lignes) {
    // Obtenir le prochain numéro
    const { data: numData } = await supabase.rpc('prochain_numero', {
      p_entreprise_id: entrepriseId,
      p_type: 'devis'
    })

    const { data, error } = await supabase
      .from('devis')
      .insert({
        entreprise_id: entrepriseId,
        client_id: devisData.client_id,
        numero: numData,
        date_devis: devisData.date_devis || new Date().toISOString().slice(0, 10),
        date_validite: devisData.date_validite,
        taux_tva: devisData.taux_tva || 10,
        type_operation: devisData.type_operation || 'services',
        statut: 'en_attente',
        notes: devisData.notes || '',
      })
      .select()
      .single()
    if (error) throw error

    // Insérer les lignes
    if (lignes?.length) {
      await supabase.from('devis_lignes').insert(
        lignes.map((l, i) => ({
          devis_id: data.id,
          description: l.description || l.desc,
          quantite: l.quantite || l.qte,
          unite: l.unite,
          prix_unitaire: l.prix_unitaire || l.pu,
          ordre: i,
        }))
      )
    }

    await load()
    return data
  }

  async function updateDevis(id, updates) {
    const { data, error } = await supabase
      .from('devis')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    await load()
    return data
  }

  async function deleteDevis(id) {
    await supabase.from('devis').delete().eq('id', id)
    setDevis(prev => prev.filter(d => d.id !== id))
  }

  async function signerDevis(id, signatureDataUrl) {
    return updateDevis(id, {
      signature_url: signatureDataUrl,
      statut: 'accepte'
    })
  }

  return { devis, loading, addDevis, updateDevis, deleteDevis, signerDevis, reload: load }
}

// ─── Abonnement (Stripe) ───
export function useSubscription(entrepriseId) {
  const [subscription, setSubscription] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!entrepriseId) return
    const { data } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('entreprise_id', entrepriseId)
      .single()
    setSubscription(data || { plan: 'free' })
    setLoading(false)
  }, [entrepriseId])

  useEffect(() => { load() }, [load])

  const plan = subscription?.plan || 'free'
  const isPro = plan === 'pro'

  return { subscription, plan, isPro, loading, reload: load }
}

// ─── Factures ───
export function useFactures(entrepriseId) {
  const [factures, setFactures] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!entrepriseId) return
    const { data } = await supabase
      .from('factures')
      .select(`*, facture_lignes(*), relances(*)`)
      .eq('entreprise_id', entrepriseId)
      .order('date_facture', { ascending: false })
    setFactures(data || [])
    setLoading(false)
  }, [entrepriseId])

  useEffect(() => { load() }, [load])

  async function creerDepuisDevis(devisData) {
    const { data: numData } = await supabase.rpc('prochain_numero', {
      p_entreprise_id: entrepriseId,
      p_type: 'facture'
    })

    const { data, error } = await supabase
      .from('factures')
      .insert({
        entreprise_id: entrepriseId,
        client_id: devisData.client_id,
        devis_id: devisData.id,
        numero: numData,
        date_facture: new Date().toISOString().slice(0, 10),
        date_echeance: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        taux_tva: devisData.taux_tva,
        type_operation: devisData.type_operation || 'services',
        statut: 'envoyee',
      })
      .select()
      .single()
    if (error) throw error

    // Copier les lignes du devis
    const lignes = devisData.devis_lignes || []
    if (lignes.length) {
      await supabase.from('facture_lignes').insert(
        lignes.map((l, i) => ({
          facture_id: data.id,
          description: l.description,
          quantite: l.quantite,
          unite: l.unite,
          prix_unitaire: l.prix_unitaire,
          ordre: i,
        }))
      )
    }

    // Marquer le devis comme facturé
    await supabase.from('devis').update({ statut: 'facture' }).eq('id', devisData.id)

    await load()
    return data
  }

  async function marquerPayee(id, modePaiement) {
    const { data, error } = await supabase
      .from('factures')
      .update({
        statut: 'payee',
        mode_paiement: modePaiement,
        date_paiement: new Date().toISOString().slice(0, 10),
      })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    await load()
    return data
  }

  async function addFactureDirecte(factureData, lignes) {
    const { data: numData } = await supabase.rpc('prochain_numero', {
      p_entreprise_id: entrepriseId,
      p_type: 'facture'
    })

    const { data, error } = await supabase
      .from('factures')
      .insert({
        entreprise_id: entrepriseId,
        client_id: factureData.client_id,
        numero: numData,
        date_facture: factureData.date_facture || new Date().toISOString().slice(0, 10),
        date_echeance: factureData.date_echeance,
        taux_tva: factureData.taux_tva || 20,
        type_operation: factureData.type_operation || 'services',
        statut: 'envoyee',
        notes: factureData.notes || '',
      })
      .select()
      .single()
    if (error) throw error

    if (lignes?.length) {
      await supabase.from('facture_lignes').insert(
        lignes.map((l, i) => ({
          facture_id: data.id,
          description: l.description || l.desc,
          quantite: l.quantite || l.qte,
          unite: l.unite,
          prix_unitaire: l.prix_unitaire || l.pu,
          ordre: i,
        }))
      )
    }

    await load()
    return data
  }

  async function envoyerRelance(factureId) {
    await supabase.from('relances').insert({
      facture_id: factureId,
      type: 'email',
    })
    await load()
  }

  return { factures, loading, creerDepuisDevis, addFactureDirecte, marquerPayee, envoyerRelance, reload: load }
}
