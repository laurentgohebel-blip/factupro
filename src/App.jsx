import { useAuth } from './lib/auth'
import Login from './pages/Login'
import FactuPro from './components/FactuPro'

export default function App() {
  const { user, entreprise, loading } = useAuth()

  if (loading) {
    return (
      <div style={{
        fontFamily: "'Outfit', system-ui, sans-serif",
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#F7F6F3',
        flexDirection: 'column', gap: 12,
      }}>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#1B4332' }}>⚡</div>
        <div style={{ fontSize: 14, color: '#7A7A72' }}>Chargement...</div>
      </div>
    )
  }

  if (!user || !entreprise) return <Login />

  return <FactuPro />
}