import { useNavigate } from 'react-router-dom'

const C = {
  primary: '#1B4332', light: '#2D6A4F', lighter: '#40916C', pale: '#D8F3DC',
  bg: '#FAFAF7', white: '#FFFFFF', border: '#E8E5DE',
  text: '#1A1A18', muted: '#6B6B63', subtle: '#A3A39B',
  accent: '#F59E0B', accentPale: '#FEF3C7',
  font: "'DM Sans', system-ui, sans-serif",
}

const FEATURES = [
  { icon: '📄', title: 'Devis en 30 secondes', desc: 'Catalogue de prestations, TVA automatique, signature électronique du client.' },
  { icon: '🧾', title: 'Facturation conforme', desc: 'Factures Factur-X (norme EN 16931), mentions légales 2026, numérotation séquentielle.' },
  { icon: '💰', title: 'Suivi des paiements', desc: 'Tableau de bord en temps réel, relances automatiques, export comptable CSV.' },
  { icon: '📊', title: 'Statistiques métier', desc: 'CA mensuel, taux de conversion devis, délai moyen de paiement, top clients.' },
  { icon: '✉', title: 'Envoi par email', desc: 'Email pré-rempli avec le PDF joint en un clic, depuis n\'importe quel appareil.' },
  { icon: '📱', title: 'Application mobile', desc: 'Installable sur iPhone et Android. Fonctionne sur chantier sans connexion.' },
]

const PLANS = [
  {
    name: 'Gratuit', price: '0€', period: 'pour toujours',
    color: C.border, bg: C.white,
    features: ['3 devis / mois', '3 factures / mois', '1 client', 'PDF & email', 'Support communauté'],
    cta: 'Commencer gratuitement', ctaStyle: 'outline',
  },
  {
    name: 'Pro', price: '9€', period: '/ mois HT',
    color: C.primary, bg: C.primary,
    badge: '⭐ Le plus populaire',
    features: ['Devis illimités', 'Factures illimitées', 'Clients illimités', 'Catalogue illimité', 'Export comptable', 'Relances automatiques', 'Support prioritaire'],
    cta: 'Essayer 14 jours gratuit', ctaStyle: 'solid',
  },
]

const FAQS = [
  { q: 'Mes données sont-elles sécurisées ?', r: 'Oui. Toutes les données sont chiffrées et hébergées en Europe (Irlande). Chaque artisan voit uniquement ses propres données.' },
  { q: 'Puis-je annuler à tout moment ?', r: 'Oui, sans engagement. Vous gardez accès à toutes vos données même après résiliation.' },
  { q: 'Est-ce que FactuPro est conforme aux obligations légales ?', r: 'Oui. Les factures respectent la norme Factur-X (EN 16931) et incluent toutes les mentions obligatoires 2026.' },
  { q: 'Fonctionne-t-il sur téléphone ?', r: 'Oui. FactuPro est une Progressive Web App installable sur iPhone et Android, optimisée pour une utilisation sur chantier.' },
]

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div style={{ fontFamily: C.font, background: C.bg, color: C.text, overflowX: 'hidden' }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp .6s cubic-bezier(.16,1,.3,1) both; }
        .fade-up-1 { animation-delay: .1s; } .fade-up-2 { animation-delay: .2s; } .fade-up-3 { animation-delay: .3s; }
        .btn-hover { transition: all .2s; }
        .btn-hover:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(27,67,50,0.25); }
        .card-hover { transition: transform .2s, box-shadow .2s; }
        .card-hover:hover { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(0,0,0,0.08); }
        .faq-item { border-bottom: 1px solid ${C.border}; }
        a { color: inherit; text-decoration: none; }
      `}</style>

      {/* NAV */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(250,250,247,0.92)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.border}`, padding: '0 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.primary, letterSpacing: -0.5 }}>⚡ FactuPro</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => navigate('/login')} className="btn-hover" style={{ padding: '8px 18px', borderRadius: 10, border: `1.5px solid ${C.border}`, background: 'transparent', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: C.font, color: C.text }}>
              Connexion
            </button>
            <button onClick={() => navigate('/login')} className="btn-hover" style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: C.primary, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
              Essayer gratuitement
            </button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ padding: '80px 24px 64px', textAlign: 'center', maxWidth: 800, margin: '0 auto' }}>
        <div className="fade-up" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.pale, color: C.primary, padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, marginBottom: 24 }}>
          ✓ Conforme aux obligations légales 2026
        </div>
        <h1 className="fade-up fade-up-1" style={{ fontSize: 'clamp(36px, 6vw, 60px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5, marginBottom: 20, color: C.text }}>
          Devis & facturation<br />
          <span style={{ color: C.primary }}>pour les artisans</span>
        </h1>
        <p className="fade-up fade-up-2" style={{ fontSize: 18, color: C.muted, lineHeight: 1.7, marginBottom: 36, maxWidth: 560, margin: '0 auto 36px' }}>
          Créez des devis professionnels, convertissez-les en factures et encaissez plus vite. Simple, rapide, depuis votre téléphone.
        </p>
        <div className="fade-up fade-up-3" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/login')} className="btn-hover" style={{ padding: '14px 32px', borderRadius: 12, border: 'none', background: C.primary, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: C.font, boxShadow: '0 4px 20px rgba(27,67,50,0.3)' }}>
            Commencer gratuitement →
          </button>
          <button onClick={() => document.getElementById('tarifs').scrollIntoView({ behavior: 'smooth' })} style={{ padding: '14px 28px', borderRadius: 12, border: `1.5px solid ${C.border}`, background: 'transparent', fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: C.font, color: C.text }}>
            Voir les tarifs
          </button>
        </div>
        <p style={{ marginTop: 16, fontSize: 13, color: C.subtle }}>Gratuit pour commencer · Aucune carte bancaire requise</p>
      </section>

      {/* MOCKUP / STATS BAND */}
      <section style={{ background: `linear-gradient(135deg, ${C.primary} 0%, ${C.lighter} 100%)`, padding: '40px 24px', margin: '0 0 80px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 32, textAlign: 'center', color: '#fff' }}>
          {[['500+', 'Artisans utilisateurs'], ['98%', 'Satisfaction client'], ['30s', 'Pour créer un devis'], ['0€', 'Pour commencer']].map(([v, l]) => (
            <div key={l}>
              <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1 }}>{v}</div>
              <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section style={{ padding: '0 24px 80px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.lighter, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Fonctionnalités</div>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, letterSpacing: -0.8 }}>Tout ce dont un artisan a besoin</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          {FEATURES.map((f, i) => (
            <div key={i} className="card-hover" style={{ background: C.white, borderRadius: 16, padding: '24px 22px', border: `1px solid ${C.border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 32, marginBottom: 14 }}>{f.icon}</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ background: C.pale, padding: '64px 24px', marginBottom: 80 }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.lighter, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Comment ça marche</div>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, letterSpacing: -0.8, marginBottom: 48 }}>Facturez en 3 étapes</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 32 }}>
            {[
              { step: '1', title: 'Créez votre devis', desc: 'Sélectionnez vos prestations depuis le catalogue, ajustez les quantités et envoyez par email.' },
              { step: '2', title: 'Le client signe', desc: 'Signature électronique directement sur l\'écran, en chantier ou à distance.' },
              { step: '3', title: 'Transformez en facture', desc: 'Un clic pour convertir le devis accepté en facture conforme et l\'envoyer.' },
            ].map(({ step, title, desc }) => (
              <div key={step} style={{ textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: C.primary, color: '#fff', fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>{step}</div>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="tarifs" style={{ padding: '0 24px 80px', maxWidth: 800, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.lighter, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Tarifs</div>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, letterSpacing: -0.8 }}>Simple et transparent</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {PLANS.map((plan) => (
            <div key={plan.name} className="card-hover" style={{ background: plan.bg, borderRadius: 20, padding: 28, border: `2px solid ${plan.color}`, position: 'relative', overflow: 'hidden' }}>
              {plan.badge && (
                <div style={{ position: 'absolute', top: 16, right: 16, background: C.accent, color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>{plan.badge}</div>
              )}
              <div style={{ fontSize: 14, fontWeight: 700, color: plan.name === 'Pro' ? 'rgba(255,255,255,0.7)' : C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>{plan.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 40, fontWeight: 800, color: plan.name === 'Pro' ? '#fff' : C.text }}>{plan.price}</span>
                <span style={{ fontSize: 14, color: plan.name === 'Pro' ? 'rgba(255,255,255,0.6)' : C.muted }}>{plan.period}</span>
              </div>
              <div style={{ height: 1, background: plan.name === 'Pro' ? 'rgba(255,255,255,0.15)' : C.border, margin: '20px 0' }} />
              <ul style={{ listStyle: 'none', marginBottom: 24 }}>
                {plan.features.map(f => (
                  <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: 14, color: plan.name === 'Pro' ? 'rgba(255,255,255,0.9)' : C.text }}>
                    <span style={{ color: plan.name === 'Pro' ? '#86efac' : C.lighter, fontSize: 16, flexShrink: 0 }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button onClick={() => navigate('/login')} className="btn-hover" style={{
                width: '100%', padding: '13px 0', borderRadius: 12, border: plan.ctaStyle === 'outline' ? `2px solid ${C.border}` : 'none',
                background: plan.ctaStyle === 'solid' ? '#fff' : 'transparent',
                color: plan.ctaStyle === 'solid' ? C.primary : C.text,
                fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: C.font,
              }}>
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: '0 24px 80px', maxWidth: 680, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 800, letterSpacing: -0.5 }}>Questions fréquentes</h2>
        </div>
        {FAQS.map(({ q, r }, i) => (
          <FaqItem key={i} q={q} r={r} />
        ))}
      </section>

      {/* CTA FINAL */}
      <section style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.lighter})`, padding: '64px 24px', textAlign: 'center', marginBottom: 0 }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, color: '#fff', letterSpacing: -0.8, marginBottom: 16 }}>
            Prêt à simplifier votre facturation ?
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.75)', marginBottom: 32, lineHeight: 1.6 }}>
            Rejoignez les artisans qui gagnent du temps chaque semaine avec FactuPro.
          </p>
          <button onClick={() => navigate('/login')} className="btn-hover" style={{ padding: '16px 40px', borderRadius: 14, border: 'none', background: '#fff', color: C.primary, fontSize: 17, fontWeight: 800, cursor: 'pointer', fontFamily: C.font, boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
            Commencer gratuitement →
          </button>
          <p style={{ marginTop: 14, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>Aucune carte bancaire · Données hébergées en Europe</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: C.text, color: 'rgba(255,255,255,0.5)', padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 8 }}>⚡ FactuPro</div>
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          Devis & facturation pour artisans · Données hébergées en Europe<br />
          <span style={{ opacity: 0.4 }}>© {new Date().getFullYear()} FactuPro · </span>
          <a href="mailto:contact@factupro.fr" style={{ opacity: 0.6 }}>contact@factupro.fr</a>
        </div>
      </footer>
    </div>
  )
}

function FaqItem({ q, r }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="faq-item" style={{ padding: '20px 0' }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, fontFamily: C.font }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>{q}</span>
        <span style={{ fontSize: 20, color: C.muted, transform: open ? 'rotate(45deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}>+</span>
      </button>
      {open && <p style={{ marginTop: 12, fontSize: 14, color: C.muted, lineHeight: 1.7 }}>{r}</p>}
    </div>
  )
}

// useState import needed for FaqItem
import { useState } from 'react'
