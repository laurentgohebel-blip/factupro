import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Landing from './pages/Landing'
import Login from './pages/Login'
import FactuPro from './components/FactuPro'
import SignaturePage from './pages/SignaturePage'

function RequireAuth({ children }) {
  const { user, entreprise, loading } = useAuth()

  if (loading) return (
    <div style={{
      fontFamily: "'DM Sans', system-ui, sans-serif",
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#F7F6F3',
      flexDirection: 'column', gap: 12,
    }}>
      <div style={{ fontSize: 32, fontWeight: 800, color: '#1B4332' }}>⚡</div>
      <div style={{ fontSize: 14, color: '#7A7A72' }}>Chargement...</div>
    </div>
  )

  if (!user || !entreprise) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<LoginRedirect />} />
      <Route path="/app" element={
        <RequireAuth>
          <FactuPro />
        </RequireAuth>
      } />
      <Route path="/sign/:devisId" element={<SignaturePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function LoginRedirect() {
  const { user, entreprise, loading } = useAuth()
  if (loading) return null
  if (user && entreprise) return <Navigate to="/app" replace />
  return <Login />
}
