import { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [entreprise, setEntreprise] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  async function loadEntreprise(userId) {
    try {
      const { data } = await supabase
        .from('entreprises')
        .select('*')
        .eq('user_id', userId)
        .single()
      setEntreprise(data)
    } catch (e) {
      console.error('Erreur chargement entreprise:', e)
      setEntreprise(null)
    }
  }

  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted) return

        if (session?.user) {
          setUser(session.user)
          await loadEntreprise(session.user.id)
        }
      } catch (e) {
        console.error('Erreur auth:', e)
      }
      if (mounted) setLoading(false)
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      if (session?.user) {
        setUser(session.user)
        await loadEntreprise(session.user.id)
      } else {
        setUser(null)
        setEntreprise(null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function signUp(email, password, entrepriseData) {
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password })
    if (authError) throw authError

    if (authData.user) {
      const { data: ent, error: entError } = await supabase
        .from('entreprises')
        .insert({
          user_id: authData.user.id,
          nom: entrepriseData.nom,
          siret: entrepriseData.siret || '',
          adresse: entrepriseData.adresse || '',
          tel: entrepriseData.tel || '',
          email: email,
        })
        .select()
        .single()
      if (entError) throw entError

      await supabase.from('catalogue').insert([
        { entreprise_id: ent.id, categorie: 'Déplacement', description: 'Déplacement zone locale', unite: 'forfait', prix_unitaire: 45 },
        { entreprise_id: ent.id, categorie: 'Déplacement', description: 'Déplacement hors zone', unite: 'forfait', prix_unitaire: 75 },
        { entreprise_id: ent.id, categorie: "Main d'œuvre", description: "Main d'œuvre qualifiée", unite: 'heure', prix_unitaire: 55 },
        { entreprise_id: ent.id, categorie: "Main d'œuvre", description: "Main d'œuvre apprenti", unite: 'heure', prix_unitaire: 30 },
      ])

      setEntreprise(ent)
    }
    return authData
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    navigate('/app')
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setEntreprise(null)
    navigate('/')
  }

  async function updateEntreprise(updates) {
    const { data, error } = await supabase
      .from('entreprises')
      .update(updates)
      .eq('id', entreprise.id)
      .select()
      .single()
    if (error) throw error
    setEntreprise(data)
    return data
  }

  return (
    <AuthContext.Provider value={{ user, entreprise, loading, signUp, signIn, signOut, updateEntreprise }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}