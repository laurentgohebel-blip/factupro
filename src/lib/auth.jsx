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
        // Restaure la session après un aller-retour Stripe (persistSession:false)
        const stash = sessionStorage.getItem('sb-checkout-session')
        if (stash) {
          sessionStorage.removeItem('sb-checkout-session')
          try {
            const { access_token, refresh_token } = JSON.parse(stash)
            if (access_token && refresh_token) {
              await supabase.auth.setSession({ access_token, refresh_token })
            }
          } catch (e) { console.error('Restauration session échouée:', e) }
        }

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

    // ⚠️ Ne PAS await d'appels Supabase ici : le callback tient un verrou
    // (navigator.locks) et un appel DB à l'intérieur provoque un deadlock
    // (splash de chargement infini). On diffère loadEntreprise hors du verrou.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (session?.user) {
        setUser(session.user)
        setTimeout(() => { if (mounted) loadEntreprise(session.user.id) }, 0)
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
    // L'entreprise (+ catalogue + abonnement free) est créée côté serveur par
    // le trigger handle_new_user sur auth.users (SECURITY DEFINER, bypass RLS).
    // On transmet le nom/SIRET via les métadonnées d'inscription.
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nom: entrepriseData.nom, siret: entrepriseData.siret || '' } },
    })
    if (authError) throw authError

    // Si la confirmation d'email est désactivée, une session est déjà active :
    // on charge l'entreprise créée par le trigger.
    if (authData.session?.user) {
      await loadEntreprise(authData.session.user.id)
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