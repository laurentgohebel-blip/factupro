import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Page d'accueil — même langage visuel que osmosetechnologies.fr :
// blanc / bleu nuit / outremer, Hanken Grotesk + IBM Plex Mono, filets fins,
// boutons pilule, bandes arrondies, maquettes d'écran en HTML.

const CSS = `
.lp{
  --papier:#FFFFFF; --fond2:#F6F9FC; --encre:#0A2540; --gris:#425466; --trait:#E3E8EE;
  --outremer:#635BFF; --lilas:#EFEEFF; --peche:#FFF0E6;
  --pad:clamp(20px,4.4vw,56px);
  --disp:"Hanken Grotesk",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;
  background:var(--papier); color:var(--encre); font-family:var(--disp);
  font-size:17px; line-height:1.55; overflow-x:hidden;
}
.lp *,.lp *::before,.lp *::after{box-sizing:border-box}
.lp a{color:inherit;text-decoration:none}
.lp :focus-visible{outline:3px solid var(--outremer);outline-offset:3px}
.lp .sheet{max-width:1280px;margin:0 auto;padding:0 var(--pad)}
.lp .mono{font-family:var(--mono)}
.lp h1,.lp h2,.lp h3{margin:0;letter-spacing:-.03em;text-wrap:balance}
.lp h2{font-size:clamp(30px,3.6vw,50px);font-weight:500;line-height:1.06;letter-spacing:-.035em;max-width:16ch}
.lp h3{font-size:21px;font-weight:600;line-height:1.15;letter-spacing:-.02em}
.lp .lede{font-size:clamp(17.5px,1.7vw,20px);line-height:1.5;color:var(--gris);max-width:46ch;margin:22px 0 0}

.lp .btn{display:inline-block;font:600 15px var(--disp);padding:12px 22px;border-radius:999px;background:var(--outremer);color:#fff;border:1.5px solid var(--outremer);cursor:pointer}
.lp .btn:hover{filter:brightness(1.12)}
.lp .btn.alt{background:transparent;color:inherit;border-color:currentColor}
.lp .btn.alt:hover{filter:none;background:var(--encre);color:var(--papier);border-color:var(--encre)}
.lp .sur-nuit .btn:not(.alt){background:#fff;border-color:#fff;color:#0A2540}
.lp .sur-bleu .btn:not(.alt){background:#fff;border-color:#fff;color:#635BFF}
.lp .sur-nuit .btn.alt:hover,.lp .sur-bleu .btn.alt:hover{background:#fff;border-color:#fff;color:#0A2540}
.lp .rang{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
.lp .note{font:400 12.5px var(--mono);color:var(--gris);margin:18px 0 0}

/* barre */
.lp .top{position:sticky;top:0;z-index:60;background:rgba(255,255,255,.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--trait)}
.lp .bar{display:flex;align-items:center;justify-content:space-between;gap:22px;height:68px}
.lp .logo{display:flex;align-items:center;gap:11px;font:600 20px/1 var(--disp);letter-spacing:-.035em}
.lp .nav{display:none;gap:30px;font-size:15.5px;font-weight:500}
.lp .nav a:hover{color:var(--outremer);text-decoration:underline;text-underline-offset:5px;text-decoration-thickness:1.5px}
@media(min-width:900px){.lp .nav{display:flex}}
.lp .acts{display:flex;gap:8px;align-items:center}
.lp .bar .btn{padding:9px 16px;font-size:14.5px}
@media(max-width:520px){.lp .bar .btn.alt{display:none}}

/* hero */
.lp .hero{position:relative;overflow:hidden;padding:clamp(40px,6vw,96px) 0 0;isolation:isolate}
.lp .ribbon{position:absolute;z-index:-1;top:-140px;right:-8%;width:78%;height:640px;pointer-events:none;
  background:linear-gradient(112deg,#FF80B5 0%,#9089FC 34%,#80E9FF 62%,#FFC58A 88%);
  clip-path:polygon(34% 0,100% 0,100% 74%,62% 100%);opacity:.92}
.lp .ribbon::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(112deg,rgba(255,255,255,0) 0 46px,rgba(255,255,255,.22) 46px 92px)}
.lp .ribbon::before{content:"";position:absolute;left:0;right:0;bottom:0;height:42%;background:linear-gradient(0deg,var(--papier),transparent);z-index:1}
@media(max-width:700px){.lp .ribbon{width:130%;right:-30%;height:420px;top:-100px;opacity:.5}}
.lp .hero-grid{display:grid;gap:44px 40px;align-items:center}
@media(min-width:980px){.lp .hero-grid{grid-template-columns:6fr 5fr}}
.lp .tagl{font:400 12.5px var(--mono);opacity:.82;margin:0 0 16px}
.lp .hero h1{font-size:clamp(36px,4.6vw,66px);font-weight:500;line-height:1.02;letter-spacing:-.04em;max-width:13ch}
.lp .hero-ui{display:flex;flex-direction:column;align-items:center;gap:14px;min-width:0}
.lp .cap{font:400 11px var(--mono);opacity:.72;margin:0;text-align:center}
.lp .deroule{list-style:none;margin:clamp(34px,5vw,68px) 0 0;padding:0;display:grid}
@media(min-width:760px){.lp .deroule{grid-template-columns:repeat(3,1fr)}}
.lp .deroule li{position:relative;border-top:1px solid var(--trait);padding:24px 28px 40px 0}
.lp .deroule li::before{content:"";position:absolute;left:0;top:-5px;width:9px;height:9px;border-radius:50%;background:var(--outremer)}
.lp .deroule .st{display:block;font:400 11.5px var(--mono);color:var(--outremer);margin-bottom:9px}
.lp .deroule b{display:block;font:600 21px/1.15 var(--disp);letter-spacing:-.02em;margin-bottom:7px}
.lp .deroule p{margin:0;color:var(--gris);font-size:15.5px;max-width:32ch}

/* sections */
.lp .sec{padding:clamp(54px,7vw,112px) 0}
.lp .sec.rule{background:var(--fond2)}
.lp .split{display:grid;gap:34px 72px}
@media(min-width:900px){.lp .split{grid-template-columns:5fr 7fr}}
.lp .cartes{display:grid;gap:24px 28px}
@media(min-width:700px){.lp .cartes{grid-template-columns:1fr 1fr}}
.lp .cartes article{background:var(--fond2);border-radius:16px;padding:26px 26px 28px;box-shadow:0 1px 0 var(--trait) inset}
.lp .cartes article::before{content:"";display:block;width:34px;height:6px;border-radius:3px;margin-bottom:18px;background:linear-gradient(90deg,#FF80B5,#635BFF)}
.lp .cartes p{margin:8px 0 0;color:var(--gris);font-size:16.5px}
.lp .rows{border-top:1px solid var(--trait)}
.lp .rows > div{padding:21px 0;border-bottom:1px solid var(--trait)}
.lp .rows p{margin:0;font-size:19px;font-weight:450;line-height:1.35}

/* bandes */
.lp .band{padding:14px var(--pad)}
.lp .band-grid{max-width:1168px;margin:0 auto;border-radius:26px;padding:clamp(28px,4.4vw,72px);display:grid;gap:44px 64px;align-items:center}
@media(min-width:940px){.lp .band-grid{grid-template-columns:1fr 1fr}}
.lp .sur-nuit{background:#0A2540;color:#fff}
.lp .nom{font-size:clamp(34px,4.2vw,56px);font-weight:500;line-height:1.02;letter-spacing:-.04em;margin-bottom:16px}
.lp .acc{font-size:clamp(18px,1.9vw,22px);line-height:1.35;max-width:30ch;margin:0 0 22px;font-weight:500}
.lp .facts{list-style:none;margin:0;padding:0;border-top:1px solid currentColor;max-width:46ch}
.lp .facts li{padding:11px 0;border-bottom:1px solid currentColor;font-size:15.5px;opacity:.94}
.lp .sur-nuit .facts,.lp .sur-nuit .facts li,.lp .sur-bleu .facts,.lp .sur-bleu .facts li{border-color:rgba(255,255,255,.34)}
.lp .sur-clair .facts,.lp .sur-clair .facts li{border-color:rgba(21,19,61,.22)}

/* maquettes d'écran */
.lp .phone{width:min(292px,100%);background:#15133D;border-radius:38px;padding:10px;box-shadow:0 50px 80px -30px rgba(10,37,64,.5),0 18px 36px -18px rgba(10,37,64,.4)}
.lp .screen{background:#fff;color:#15133D;border-radius:29px;padding:24px 18px 18px;font-size:13px;line-height:1.35;min-height:520px;display:flex;flex-direction:column;gap:10px}
.lp .ph-top{display:flex;justify-content:space-between;align-items:center}
.lp .ph-title{font:700 18px var(--disp);letter-spacing:-.02em}
.lp .chip{font:500 11px var(--mono);background:#E4E1FB;color:#635BFF;padding:3px 9px;border-radius:99px;white-space:nowrap}
.lp .chip.ok{background:#DDF5E7;color:#0E6B3A}
.lp .chip.att{background:#FFF0E6;color:#A8481A}
.lp .chip.ret{background:#FDE3E3;color:#A32020}
.lp .ph-ref{font:400 11px var(--mono);color:#5A5877}
.lp .ph-client{border:1px solid #E4E1FB;border-radius:11px;padding:10px 12px}
.lp .ph-client b{display:block;font-size:14px}
.lp .ph-client span{color:#5A5877;font-size:12px}
.lp .ph-lines div{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #ECEAF7}
.lp .ph-lines span:last-child{font:400 12px var(--mono);white-space:nowrap}
.lp .ph-tot{margin-top:auto;display:grid;gap:4px;font-size:12px;color:#5A5877}
.lp .ph-tot div{display:flex;justify-content:space-between}
.lp .ph-tot span:last-child{font-family:var(--mono)}
.lp .ph-tot .ttc{border-top:1.5px solid #15133D;margin-top:6px;padding-top:9px;font:700 15px var(--disp);color:#15133D}
.lp .ph-tot .ttc span:last-child{font:700 15px var(--disp)}
.lp .ph-btn{background:#635BFF;color:#fff;text-align:center;font-weight:600;font-size:13px;padding:11px;border-radius:10px}
.lp .ph-sub{font:400 10.5px var(--mono);color:#5A5877;text-align:center}
.lp .win{width:100%;max-width:520px;background:#fff;color:#15133D;border-radius:14px;overflow:hidden;box-shadow:0 40px 70px -30px rgba(0,0,0,.55);font-size:13px}
.lp .win-bar{display:flex;align-items:center;gap:6px;padding:11px 14px;background:#EFEEFF;font:400 11px var(--mono);color:#5A5877}
.lp .win-bar i{width:8px;height:8px;border-radius:50%;background:#C9C6EE;display:block}
.lp .win-bar span{margin-left:8px}
.lp .win-body{padding:16px 18px 18px}
.lp .win-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:8px}
.lp .win-h b{font:700 16px var(--disp);letter-spacing:-.02em}
.lp .win-h span{font:400 11px var(--mono);color:#5A5877}
.lp .fl{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:11px 0;border-top:1px solid #ECEAF7}
.lp .fl b{display:block;font-size:13.5px}
.lp .fl small{color:#5A5877;font-size:11.5px}
.lp .fl .mt{font:400 12px var(--mono);white-space:nowrap}
@media(max-width:420px){.lp .fl{grid-template-columns:1fr auto}.lp .fl .mt{display:none}}

/* tarifs */
.lp .plans{display:grid;gap:20px;margin-top:clamp(34px,4vw,56px)}
@media(min-width:800px){.lp .plans{grid-template-columns:1fr 1fr}}
.lp .plan{border-radius:26px;padding:clamp(26px,3.4vw,48px);display:flex;flex-direction:column}
.lp .plan.sur-clair{background:var(--fond2);box-shadow:0 1px 0 var(--trait) inset}
.lp .plan.sur-bleu{background:linear-gradient(135deg,#635BFF 0%,#8A6BFF 55%,#C06BE8 100%);color:#fff}
.lp .prix{display:flex;align-items:baseline;gap:10px;margin:0 0 22px}
.lp .prix b{font:500 clamp(44px,5vw,64px)/1 var(--disp);letter-spacing:-.04em}
.lp .prix span{font:400 12.5px var(--mono);opacity:.82}
.lp .plan .facts{max-width:none;margin-bottom:28px}
.lp .plan .btn{margin-top:auto;align-self:flex-start}

/* questions */
.lp .faq{border-top:1px solid var(--trait)}
.lp .faq > div{border-bottom:1px solid var(--trait)}
.lp .faq button{width:100%;display:flex;justify-content:space-between;align-items:center;gap:18px;padding:21px 0;background:none;border:0;cursor:pointer;text-align:left;color:inherit;font:450 19px/1.35 var(--disp)}
.lp .faq button i{flex:0 0 auto;font:400 22px/1 var(--mono);font-style:normal;color:var(--outremer);transition:transform .2s}
.lp .faq button[aria-expanded="true"] i{transform:rotate(45deg)}
.lp .faq p{margin:0;padding:0 0 22px;color:var(--gris);font-size:16.5px;max-width:60ch}

/* appel final + pied */
.lp .fin{max-width:1168px;margin:0 auto;border-radius:26px;padding:clamp(34px,5vw,84px) clamp(28px,4.4vw,72px)}
.lp .fin h2{max-width:18ch}
.lp .fin .lede{color:#A3B3CC}
.lp .pied{padding:clamp(44px,5vw,72px) 0 34px;font-size:15px}
.lp .pied-grid{display:grid;gap:34px 40px}
@media(min-width:800px){.lp .pied-grid{grid-template-columns:2fr 1fr 1fr 1fr}}
.lp .pied h4{margin:0 0 12px;font:400 11.5px var(--mono);color:var(--gris);letter-spacing:0}
.lp .pied ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.lp .pied a:hover,.lp .pied button:hover{color:var(--outremer)}
.lp .pied button{background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;text-align:left}
.lp .pied .legal{margin-top:40px;padding-top:20px;border-top:1px solid var(--trait);color:var(--gris);font-size:13.5px}
`

const ETAPES = [
  ['Devis', 'Vos prestations viennent du catalogue. La TVA et les totaux se calculent seuls.'],
  ['Signature', 'Le client signe sur l\'écran, sur place, ou à distance par un lien.'],
  ['Facture', 'Le devis accepté devient une facture, envoyée par email avec son PDF.'],
]

const FONCTIONS = [
  ['Devis en trente secondes', 'Catalogue de prestations, remises, TVA automatique. Le devis part par email et se signe en ligne.'],
  ['Factures en règle', 'Mentions légales obligatoires et numérotation séquentielle sans rupture, sur chaque document.'],
  ['Suivi des paiements', 'Chaque facture a un statut : émise, envoyée, payée, en retard. Les envois sont horodatés.'],
  ['Relance en un geste', 'Un email de relance prêt à partir pour chaque facture échue, avec l\'historique des rappels.'],
  ['Chiffres du mois', 'Chiffre d\'affaires, taux de conversion des devis, délai moyen de paiement, export comptable CSV.'],
  ['Sur le téléphone', 'Application installable sur iPhone et Android, pensée pour être utilisée sur le chantier.'],
]

const ENGAGEMENTS = [
  'Mentions légales obligatoires sur chaque document',
  'Numérotation séquentielle, sans rupture',
  'Une facture émise ne se modifie pas : la correction passe par un avoir',
  'Données chiffrées, hébergées en Europe',
  'Sans engagement, vos données restent accessibles',
]

const FORMULES = [
  {
    nom: 'gratuit', prix: '0 €', periode: 'pour toujours', ton: 'sur-clair',
    points: ['5 devis par mois', '5 factures par mois', 'Clients illimités', 'PDF et envoi par email', 'Support communauté'],
    cta: 'Commencer gratuitement', alt: true,
  },
  {
    nom: 'pro', prix: '9 €', periode: 'par mois, hors taxes', ton: 'sur-bleu',
    points: ['Devis et factures illimités', 'Clients et catalogue illimités', 'Export comptable', 'Relances par email', 'Support prioritaire'],
    cta: 'Passer à Pro',
  },
]

const QUESTIONS = [
  ['Mes données sont-elles en sécurité ?', 'Oui. Toutes les données sont chiffrées et hébergées en Europe (Irlande). Vous voyez uniquement vos propres données.'],
  ['Puis-je arrêter à tout moment ?', 'Oui, sans engagement. Vous gardez accès à toutes vos données même après résiliation.'],
  ['FactuPro est-il conforme aux obligations légales ?', 'Les factures incluent les mentions légales obligatoires et une numérotation séquentielle sans rupture. La facturation électronique (Factur-X via une plateforme agréée), imposée aux TPE et PME au 1er septembre 2027, est en cours de préparation.'],
  ['Est-ce que ça fonctionne sur téléphone ?', 'Oui. FactuPro est une application web installable sur iPhone et Android, optimisée pour une utilisation sur chantier.'],
]

function Marque({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0A2540" />
      <path d="M36 10 17 37h13l-3 17 20-28H34z" fill="#FFFFFF" />
      <path d="M36 10 17 37h13l1.2-6.8z" fill="#8F8AFF" />
    </svg>
  )
}

export default function Landing() {
  const navigate = useNavigate()
  const entrer = () => navigate('/login')
  const vers = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }

  return (
    <div className="lp">
      <style>{CSS}</style>

      <header className="top">
        <div className="sheet bar">
          <a className="logo" href="/" aria-label="FactuPro, accueil"><Marque /> FactuPro</a>
          <nav className="nav" aria-label="Sections">
            <a href="#fonctions" onClick={vers('fonctions')}>Fonctionnalités</a>
            <a href="#suivi" onClick={vers('suivi')}>Suivi</a>
            <a href="#tarifs" onClick={vers('tarifs')}>Tarifs</a>
            <a href="#questions" onClick={vers('questions')}>Questions</a>
          </nav>
          <div className="acts">
            <button className="btn alt" onClick={entrer}>Connexion</button>
            <button className="btn" onClick={entrer}>Essayer gratuitement</button>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="ribbon" aria-hidden="true" />
          <div className="sheet">
            <div className="hero-grid">
              <div>
                <p className="tagl">devis et facturation · artisans</p>
                <h1>Devis et factures, faits sur le chantier.</h1>
                <p className="lede">
                  FactuPro sert à chiffrer, faire signer et facturer depuis le téléphone.
                  Le devis accepté devient une facture en un geste, avec les mentions légales
                  et une numérotation sans rupture.
                </p>
                <div className="rang">
                  <button className="btn" onClick={entrer}>Commencer gratuitement</button>
                  <a className="btn alt" href="#tarifs" onClick={vers('tarifs')}>Voir les tarifs</a>
                </div>
                <p className="note">gratuit pour commencer · aucune carte bancaire</p>
              </div>

              <div className="hero-ui">
                <div className="phone" role="img" aria-label="Écran d'un devis dans l'application">
                  <div className="screen">
                    <div className="ph-top"><span className="ph-title">Devis</span><span className="chip ok">Signé</span></div>
                    <div className="ph-ref">D-2026-0412 · 15 oct. 2026</div>
                    <div className="ph-client"><b>M. et Mme Lartigue</b><span>Rénovation salle de bain · Hagetmau</span></div>
                    <div className="ph-lines">
                      <div><span>Main d'œuvre, 6 h</span><span>360,00 €</span></div>
                      <div><span>Fournitures</span><span>612,50 €</span></div>
                      <div><span>Déplacement</span><span>45,00 €</span></div>
                    </div>
                    <div className="ph-tot">
                      <div><span>Total HT</span><span>1 017,50 €</span></div>
                      <div><span>TVA 20 %</span><span>203,50 €</span></div>
                      <div className="ttc"><span>Total TTC</span><span>1 221,00 €</span></div>
                    </div>
                    <div className="ph-btn">Transformer en facture</div>
                    <div className="ph-sub">signé par le client à 09:47</div>
                  </div>
                </div>
                <p className="cap">Écran d'illustration, données fictives.</p>
              </div>
            </div>

            <ol className="deroule">
              {ETAPES.map(([titre, texte], i) => (
                <li key={titre}>
                  <span className="st">étape {i + 1}</span>
                  <b>{titre}</b>
                  <p>{texte}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="sec" id="fonctions">
          <div className="sheet split">
            <div>
              <h2>Ce que fait l'application.</h2>
              <p className="lede">
                Le nécessaire pour tenir sa facturation sans y passer ses soirées :
                chiffrer vite, envoyer proprement, savoir qui a payé.
              </p>
            </div>
            <div className="cartes">
              {FONCTIONS.map(([titre, texte]) => (
                <article key={titre}><h3>{titre}</h3><p>{texte}</p></article>
              ))}
            </div>
          </div>
        </section>

        <section className="sec rule">
          <div className="sheet split">
            <div>
              <h2>En règle, sans y penser.</h2>
              <p className="lede">
                Les obligations sont tenues par l'application : vous remplissez le devis,
                elle s'occupe du reste.
              </p>
            </div>
            <div className="rows">
              {ENGAGEMENTS.map(t => <div key={t}><p>{t}</p></div>)}
            </div>
          </div>
        </section>

        <section className="band" id="suivi">
          <div className="band-grid sur-nuit">
            <div className="hero-ui">
              <div className="win" role="img" aria-label="Liste de factures avec leur statut">
                <div className="win-bar"><i /><i /><i /><span>factupro / factures</span></div>
                <div className="win-body">
                  <div className="win-h"><b>Factures</b><span>4 émises · 1 en retard</span></div>
                  <div className="fl"><div><b>F-2026-0118</b><small>SARL Les Pins · envoyé le 12/10</small></div><span className="mt">1 221,00 €</span><span className="chip ok">Payée</span></div>
                  <div className="fl"><div><b>F-2026-0119</b><small>M. Dupouy · envoyé le 14/10</small></div><span className="mt">864,00 €</span><span className="chip">Envoyée</span></div>
                  <div className="fl"><div><b>F-2026-0120</b><small>Garage Castaings · jamais envoyé</small></div><span className="mt">2 310,00 €</span><span className="chip att">Émise</span></div>
                  <div className="fl"><div><b>F-2026-0117</b><small>Mme Labat · échue depuis 9 jours</small></div><span className="mt">540,00 €</span><span className="chip ret">En retard</span></div>
                </div>
              </div>
              <p className="cap">Écran d'illustration, données fictives.</p>
            </div>
            <div>
              <p className="tagl">suivi des encaissements</p>
              <h3 className="nom">Qui a payé, qui doit encore.</h3>
              <p className="acc">Chaque facture dit où elle en est, et chaque envoi laisse une trace.</p>
              <ul className="facts">
                <li>Statut réel : émise, envoyée, payée ou en retard</li>
                <li>Date du dernier envoi sur chaque facture</li>
                <li>Relance par email en un geste pour les factures échues</li>
              </ul>
              <div className="rang"><button className="btn" onClick={entrer}>Essayer gratuitement</button></div>
            </div>
          </div>
        </section>

        <section className="sec" id="tarifs">
          <div className="sheet">
            <div className="split">
              <h2>Deux formules.</h2>
              <p className="lede" style={{ marginTop: 0 }}>
                Le compte gratuit suffit pour démarrer. La formule Pro lève les limites,
                au mois, sans durée minimale.
              </p>
            </div>
            <div className="plans">
              {FORMULES.map(f => (
                <article key={f.nom} className={`plan ${f.ton}`}>
                  <p className="tagl">{f.nom}</p>
                  <p className="prix"><b>{f.prix}</b><span>{f.periode}</span></p>
                  <ul className="facts">{f.points.map(p => <li key={p}>{p}</li>)}</ul>
                  <button className={`btn${f.alt ? ' alt' : ''}`} onClick={entrer}>{f.cta}</button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="sec rule" id="questions">
          <div className="sheet split">
            <div><h2>Questions fréquentes.</h2></div>
            <div className="faq">
              {QUESTIONS.map(([q, r]) => <Question key={q} q={q} r={r} />)}
            </div>
          </div>
        </section>

        <section className="band" style={{ paddingTop: 'clamp(40px,5vw,72px)' }}>
          <div className="fin sur-nuit">
            <h2>Essayez sur votre prochain devis.</h2>
            <p className="lede">Le compte gratuit suffit pour commencer. Aucune carte bancaire n'est demandée.</p>
            <div className="rang">
              <button className="btn" onClick={entrer}>Commencer gratuitement</button>
              <a className="btn alt" href="mailto:contact@factupro.fr">Nous écrire</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="pied">
        <div className="sheet">
          <div className="pied-grid">
            <div>
              <a className="logo" href="/"><Marque size={30} /> FactuPro</a>
              <p style={{ margin: '14px 0 0', color: 'var(--gris)', maxWidth: '34ch' }}>Devis et facturation pour les artisans.</p>
            </div>
            <div>
              <h4>produit</h4>
              <ul>
                <li><a href="#fonctions" onClick={vers('fonctions')}>Fonctionnalités</a></li>
                <li><a href="#tarifs" onClick={vers('tarifs')}>Tarifs</a></li>
                <li><a href="#questions" onClick={vers('questions')}>Questions</a></li>
              </ul>
            </div>
            <div>
              <h4>compte</h4>
              <ul>
                <li><button onClick={entrer}>Connexion</button></li>
                <li><button onClick={entrer}>Créer un compte</button></li>
              </ul>
            </div>
            <div>
              <h4>contact</h4>
              <ul><li><a href="mailto:contact@factupro.fr">contact@factupro.fr</a></li></ul>
            </div>
          </div>
          <p className="legal">
            © {new Date().getFullYear()} FactuPro. Un logiciel{' '}
            <a href="https://osmosetechnologies.fr/" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>Osmose Technologies</a>.
            Données hébergées en Europe.
          </p>
        </div>
      </footer>
    </div>
  )
}

function Question({ q, r }) {
  const [ouvert, setOuvert] = useState(false)
  return (
    <div>
      <button onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert}>
        <span>{q}</span><i aria-hidden="true">+</i>
      </button>
      {ouvert && <p>{r}</p>}
    </div>
  )
}
