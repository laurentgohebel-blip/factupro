import { useState } from 'react'
import { useAuth } from '../lib/auth'

const ac = '#1B4332', bg = '#FAFAF7', cBg = '#FFF', brd = '#E8E5DE', tS = '#6B6B63'
const ft = "'DM Sans', system-ui, sans-serif"

export default function Login() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('login') // login | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nom, setNom] = useState('')
  const [siret, setSiret] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      if (mode === 'login') {
        await signIn(email, password)
      } else {
        if (!nom.trim()) { setError('Le nom de votre entreprise est requis'); setLoading(false); return }
        await signUp(email, password, { nom, siret })
        setSuccess('Compte créé ! Vérifiez votre email pour confirmer votre inscription.')
      }
    } catch (err) {
      setError(err.message === 'Invalid login credentials' 
        ? 'Email ou mot de passe incorrect' 
        : err.message)
    }
    setLoading(false)
  }

  const inputStyle = {
    width: '100%', padding: '12px 14px', borderRadius: 10,
    border: `1px solid ${brd}`, fontSize: 14, fontFamily: ft,
    outline: 'none', boxSizing: 'border-box', background: bg,
  }

  return (
    <div style={{ fontFamily: ft, background: bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      
      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 36, fontWeight: 800, color: ac, letterSpacing: -1 }}>⚡ FactuPro</div>
        <div style={{ fontSize: 14, color: tS, marginTop: 4 }}>Devis & facturation pour artisans</div>
      </div>

      {/* Card */}
      <div style={{
        background: cBg, borderRadius: 16, border: `1px solid ${brd}`,
        padding: 28, width: '100%', maxWidth: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>
        {/* Tabs */}
        <div style={{ display: 'flex', marginBottom: 24, background: bg, borderRadius: 10, padding: 3 }}>
          {['login', 'signup'].map(m => (
            <button key={m} onClick={() => { setMode(m); setError(''); setSuccess(''); }}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
                fontFamily: ft, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: mode === m ? cBg : 'transparent',
                color: mode === m ? ac : tS,
                boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}>
              {m === 'login' ? 'Connexion' : 'Créer un compte'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: tS, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }}>
                  Nom de l'entreprise *
                </label>
                <input style={inputStyle} value={nom} onChange={e => setNom(e.target.value)}
                  placeholder="ex: Plomberie Martin" required />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: tS, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }}>
                  SIRET (optionnel)
                </label>
                <input style={inputStyle} value={siret} onChange={e => setSiret(e.target.value)}
                  placeholder="123 456 789 00012" />
              </div>
            </>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: tS, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }}>
              Email
            </label>
            <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="vous@email.com" required />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: tS, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }}>
              Mot de passe
            </label>
            <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Min. 6 caractères" required minLength={6} />
          </div>

          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#991B1B' }}>
              ⚠ {error}
            </div>
          )}

          {success && (
            <div style={{ background: '#D1FAE5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#065F46' }}>
              ✓ {success}
            </div>
          )}

          <button type="submit" disabled={loading}
            style={{
              width: '100%', padding: '13px 0', borderRadius: 10, border: 'none',
              background: loading ? '#95D5B2' : ac, color: '#fff',
              fontSize: 15, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
              fontFamily: ft, letterSpacing: -0.2,
            }}>
            {loading ? '...' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 20, fontSize: 12, color: tS, textAlign: 'center', lineHeight: 1.6 }}>
        Gratuit · Données sécurisées · Conforme aux obligations légales
      </div>
    </div>
  )
}
