import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const G = '#1B4332'
const GL = '#40916C'

function fmt(n) { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0) }
function dfr(s) { if (!s) return '—'; try { return new Date(s).toLocaleDateString('fr-FR') } catch { return s } }
function tl(ls) { return (ls || []).reduce((s, l) => s + (parseFloat(l.quantite) || 0) * (parseFloat(l.prix_unitaire) || 0), 0) }

export default function SignaturePage() {
  const { devisId } = useParams()
  const [devis, setDevis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [signed, setSigned] = useState(false)
  const [signing, setSigning] = useState(false)
  const [refused, setRefused] = useState(false)
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const initialized = useRef(false)

  useEffect(() => { fetchDevis() }, [devisId])

  async function fetchDevis() {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-devis-public?id=${devisId}`,
        { headers: { 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` } }
      )
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setDevis(json)
      if (json.statut === 'accepte' || json.signature_url) setSigned(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function initCanvas() {
    const c = canvasRef.current
    if (!c || initialized.current) return
    const w = c.offsetWidth, h = c.offsetHeight
    if (!w || !h) return
    const dpr = window.devicePixelRatio || 1
    c.width = w * dpr; c.height = h * dpr
    const ctx = c.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = '#1a1a18'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    initialized.current = true
  }

  useEffect(() => {
    if (!devis || signed) return
    const id = requestAnimationFrame(() => {
      initCanvas()
      if (!initialized.current) {
        const ro = new ResizeObserver(() => { initCanvas(); if (initialized.current) ro.disconnect() })
        if (canvasRef.current) ro.observe(canvasRef.current)
      }
    })
    return () => cancelAnimationFrame(id)
  }, [devis, signed])

  function getPos(e) {
    const r = canvasRef.current.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }

  function draw(e) {
    if (!drawing.current) return
    e.preventDefault()
    const p = getPos(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    lastPos.current = p
  }

  function clearCanvas() {
    const c = canvasRef.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
  }

  async function handleSign() {
    const c = canvasRef.current
    // Vérifier que la signature n'est pas vide
    const ctx = c.getContext('2d')
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    if (!data.some(v => v !== 0)) { alert('Veuillez signer avant de valider.'); return }

    setSigning(true)
    try {
      const signatureDataUrl = c.toDataURL('image/png')
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-signature-public`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ devisId, signatureDataUrl }),
        }
      )
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setSigned(true)
    } catch (e) {
      alert('Erreur : ' + e.message)
    } finally {
      setSigning(false)
    }
  }

  async function handleRefuse() {
    if (!confirm('Êtes-vous sûr de vouloir refuser ce devis ?')) return
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-signature-public`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ devisId, signatureDataUrl: null, statut: 'refuse' }),
        }
      )
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setRefused(true)
    } catch (e) { alert('Erreur : ' + e.message) }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', background: '#f4f4f0' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: `3px solid ${G}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ color: '#666', fontSize: 14 }}>Chargement du devis...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', background: '#f4f4f0', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Devis introuvable</div>
        <div style={{ fontSize: 13, color: '#666' }}>{error}</div>
      </div>
    </div>
  )

  if (refused) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', background: '#f4f4f0', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Devis refusé</div>
        <div style={{ fontSize: 13, color: '#666' }}>Votre réponse a bien été transmise.</div>
      </div>
    </div>
  )

  const e = devis.entreprises || {}
  const cl = devis.clients || {}
  const lignes = (devis.devis_lignes || []).sort((a, b) => a.ordre - b.ordre)
  const ht = tl(lignes)
  const tv = parseFloat(devis.taux_tva) || 10
  const tva = ht * tv / 100
  const tot = ht + tva

  if (signed) return (
    <div style={{ minHeight: '100vh', background: '#f4f4f0', fontFamily: 'system-ui, sans-serif', padding: '24px 16px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ background: `linear-gradient(135deg, ${G}, ${GL})`, borderRadius: 16, padding: '20px 24px', color: '#fff', marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Devis accepté !</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>Merci — {e.nom} a bien reçu votre accord.</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 16, padding: 20, textAlign: 'center', fontSize: 13, color: '#666' }}>
          {e.nom} vous contactera prochainement pour démarrer les travaux.<br /><br />
          {e.tel && <div>📞 {e.tel}</div>}
          {e.email && <div>✉ {e.email}</div>}
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f4f4f0', fontFamily: 'system-ui, sans-serif', padding: '0 0 40px' }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${G}, ${GL})`, padding: '20px 24px', color: '#fff' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 2 }}>⚡ FactuPro</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{e.nom}</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>Devis {devis.numero} · {dfr(devis.date_devis)}</div>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 0' }}>
        {/* Client */}
        <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 12, boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Destinataire</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{cl.nom}</div>
          {cl.adresse && <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{cl.adresse}</div>}
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: '#555' }}>
            <span><span style={{ color: '#999' }}>Validité </span>{dfr(devis.date_validite)}</span>
            <span><span style={{ color: '#999' }}>TVA </span>{tv}%</span>
          </div>
        </div>

        {/* Lignes */}
        <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 12, boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Prestations</div>
          {lignes.map((l, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < lignes.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{l.description}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{l.quantite} {l.unite} × {fmt(l.prix_unitaire)}</div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, color: G }}>{fmt(parseFloat(l.quantite) * parseFloat(l.prix_unitaire))}</div>
            </div>
          ))}
          <div style={{ borderTop: `2px solid ${G}`, marginTop: 10, paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', marginBottom: 3 }}><span>Total HT</span><span>{fmt(ht)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888', marginBottom: 6 }}><span>TVA {tv}%</span><span>{fmt(tva)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, fontWeight: 800, color: G }}><span>Total TTC</span><span>{fmt(tot)}</span></div>
          </div>
        </div>

        {/* Notes */}
        {devis.notes && (
          <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 12, boxShadow: '0 1px 8px rgba(0,0,0,0.06)', fontSize: 13, color: '#444', lineHeight: 1.6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Notes</div>
            {devis.notes}
          </div>
        )}

        {/* Signature */}
        <div style={{ background: '#fff', borderRadius: 14, padding: '16px', marginBottom: 12, boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>✍ Signature électronique</div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>En signant, vous acceptez le devis ci-dessus. Cette signature a valeur d'engagement.</div>
          <div style={{ border: '2px dashed #d4d4cc', borderRadius: 10, overflow: 'hidden', background: '#fafaf8', marginBottom: 12, touchAction: 'none' }}>
            <canvas
              ref={canvasRef}
              style={{ display: 'block', width: '100%', height: 160, cursor: 'crosshair', touchAction: 'none' }}
              onMouseDown={e => { e.preventDefault(); drawing.current = true; lastPos.current = getPos(e) }}
              onMouseMove={draw}
              onMouseUp={() => { drawing.current = false }}
              onMouseLeave={() => { drawing.current = false }}
              onTouchStart={e => { e.preventDefault(); drawing.current = true; lastPos.current = getPos(e) }}
              onTouchMove={draw}
              onTouchEnd={() => { drawing.current = false }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button onClick={clearCanvas} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e0e0d8', background: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Effacer</button>
          </div>
          <button
            onClick={handleSign}
            disabled={signing}
            style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: signing ? GL : G, color: '#fff', fontSize: 15, fontWeight: 700, cursor: signing ? 'wait' : 'pointer', marginBottom: 10, boxShadow: '0 4px 14px rgba(27,67,50,0.3)' }}
          >
            {signing ? 'Envoi en cours...' : '✅ Accepter et signer le devis'}
          </button>
          <button
            onClick={handleRefuse}
            style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid #fecaca', background: '#fff5f5', color: '#991B1B', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            ❌ Refuser le devis
          </button>
        </div>

        {/* Footer artisan */}
        <div style={{ textAlign: 'center', fontSize: 11, color: '#aaa', marginTop: 8 }}>
          {e.nom} · SIRET {e.siret}<br />
          {e.adresse}<br />
          Envoyé via ⚡ FactuPro
        </div>
      </div>
    </div>
  )
}
