# TrackQr

App Shopify de **QR codes dynamiques** : chaque code passe par une URL courte TrackQr, ce qui permet de compter les scans, de changer la destination sans réimprimer, d'appliquer un code de réduction, de router selon l'appareil ou le pays, de collecter des e-mails sur des pages de campagne et d'attribuer les commandes Shopify aux scans.

Stack : React Router 7 + `@shopify/shopify-app-react-router`, Prisma 6 / PostgreSQL, hébergement Vercel, extensions Shopify (thème + Flow).

---

## Forfaits

| | Free | Starter — 9 $/mois (84 $/an) | Growth — 29 $/mois (276 $/an) |
|---|---|---|---|
| QR codes dynamiques | 3 | 25 | illimités |
| Pages de campagne | 1 | 5 | illimitées |
| Historique des stats | 30 jours | 90 jours | illimité |
| Design (logo, couleurs, cadres, modèles) | style standard | ✓ | ✓ |
| Stats détaillées (appareils, pays, chronologie) | compteur | ✓ | ✓ |
| Exports CSV, SVG/PDF, ZIP, planches d'impression | PNG | ✓ | ✓ |
| Création en masse (catalogue / CSV) | — | ✓ | ✓ |
| Page de secours personnalisée | — | ✓ | ✓ |
| QR codes par commande (e-mails, bordereaux) | — | ✓ | ✓ |
| Attribution des commandes et du chiffre d'affaires | — | — | ✓ |
| Routage intelligent + tests A/B | — | — | ✓ |
| Leads → clients Shopify, codes de réduction uniques | — | — | ✓ |
| Déclencheurs Shopify Flow, GA4 / Meta Pixel | — | — | ✓ |
| Support prioritaire | — | — | ✓ |

Pas d'essai gratuit : chaque boutique démarre sur Free. Les éléments au-delà des limites d'un forfait sont **mis en pause, jamais supprimés**, et reviennent automatiquement.

Le verrouillage se règle à un seul endroit : `app/lib/plan.constants.ts` (`FEATURE_MIN_PLAN`). Les cinq premières fonctionnalités sont aussi des colonnes de la table `Plan` (migrations de tarification).

---

## Architecture

```
app/
  routes/
    app.*.tsx              Admin intégré (tableau de bord, création, Mes QR codes, création en masse,
                           statistiques, campagnes + éditeur, paramètres, tarifs, aide)
    s.$slug.tsx            Scan : redirection, routage, pages Texte / Wi-Fi / vCard, page de secours
    c.$slug.tsx            Page de campagne publique (+ formulaire d'inscription)
    campaigns_.$id.preview Aperçu signé d'une campagne (lien valable 24 h)
    qr.$id.(png|svg|pdf)   Rendus d'un QR code (?ref= pour les QR par commande)
    api.cron.weekly-report Rapport hebdomadaire (cron Vercel)
    webhooks.*             Commandes (attribution), RGPD, désinstallation, scopes
  lib/
    plan.constants.ts      Forfaits et fonctionnalités par forfait (client-safe)
    plan.server.ts         Droits, quotas, mise en pause automatique
    qr.server.ts           Construction des redirections (UTM, réduction, panier)
    routing.ts             Règles de routage intelligent + A/B
    attribution*.ts        Paramètres de scan → attributs de panier → commande
    leads / rewards / customers / flow .server.ts   Inscriptions, codes uniques, clients, Flow
    weekly-report.server.ts Rapport hebdomadaire par e-mail
    i18n.ts, i18n.server.ts Traductions (voir plus bas)
  locales/fr.ts            Dictionnaire français de l'admin
extensions/
  trackqr-attribution      Intégration d'app (thème) qui copie le scan dans le panier
  flow-lead-captured       Déclencheur Flow « Campaign lead captured »
  flow-order-attributed    Déclencheur Flow « Order attributed to QR code »
```

Principes :

- **Jamais de page d'erreur** : un code en pause, programmé, expiré ou hors quota redirige vers la page de secours (ou l'accueil de la boutique) et le scan est compté comme « manqué ».
- Les scans des robots (aperçus de liens, etc.) ne sont pas comptés ; les IP sont hachées avec un sel quotidien, jamais stockées.
- Les contenus saisis par le marchand sont assainis (`url-safety.ts`) ; les CSV sont protégés contre l'injection de formules ; les aperçus utilisent des jetons HMAC.

---

## Développement local

Prérequis : Node 20.19+ ou 22.12+, PostgreSQL, [Shopify CLI](https://shopify.dev/docs/apps/tools/cli).

```bash
npm install
cp .env.example .env          # puis renseigner DATABASE_URL, SMTP…
npx prisma migrate deploy
npm run dev                   # shopify app dev
```

| Script | Rôle |
|---|---|
| `npm run dev` | Serveur de développement via Shopify CLI |
| `npm run build` | Build de production |
| `npm test` | Tests unitaires (Vitest) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Types des routes + `tsc` |
| `npm run setup` | `prisma generate` + `prisma migrate deploy` |

Les tests couvrent les modules purs : routage, redirections, sécurité des URL, CSV, Wi-Fi, signatures, forfaits et traductions (dont un test qui échoue si un texte de l'admin n'a pas de traduction française).

---

## Traductions

**Admin (anglais + français)** — `app/lib/i18n.ts` :

- la clé est le texte anglais : `t("Save settings")` ;
- `t("Upgrade to {plan}", { plan })` interpole, `tp(n, "{count} scan", "{count} scans")` gère les pluriels (0 est singulier en français, et des variantes `clé|one` / `clé|other` existent quand l'anglais n'a qu'une forme) ;
- `tm(message)` traduit les messages renvoyés par le serveur, y compris ceux qui contiennent des valeurs (motifs `{plan}`) ;
- `tx()` / `tem()` gèrent les phrases avec balisage et les titres de page avec un mot mis en valeur (`<em>…</em>`) ;
- la langue vient du paramètre `locale` que Shopify ajoute à l'ouverture de l'app (sinon la langue du navigateur). Elle est mémorisée dans les réglages de la boutique pour les **e-mails** (rapport hebdomadaire, alertes de leads).

Ajouter une langue : créer `app/locales/xx.ts` sur le modèle de `fr.ts`, l'ajouter à `LOCALES` et `DICTIONARIES` dans `i18n.ts`, puis lancer `npm test`.

**Pages publiques** — dans la langue du visiteur (en, fr, es, de, pt) : `s.$slug.tsx` (pages Texte / Wi-Fi / vCard) et `app/lib/campaign-copy.ts` (boutons et messages des pages de campagne). Le contenu écrit par le marchand est affiché tel quel.

---

## Déploiement

1. **Shopify** : `npm run deploy` (`shopify app deploy`) publie les scopes (`read_products, write_discounts, read_orders` + `write_customers` optionnel, demandé depuis Paramètres), les webhooks (API `2026-07`) et les extensions (intégration de thème + 2 déclencheurs Flow).
2. **Vercel** : renseigner les variables de `.env.example` (au minimum `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`, `IP_HASH_PEPPER`, `CRON_SECRET`, SMTP). Le build applique les migrations Prisma. Le cron `/api/cron/weekly-report` (déclaré dans `vercel.json`) envoie les rapports hebdomadaires.
3. **Domaine de scan (recommandé)** : `SCAN_BASE_URL=https://scan.votremarque.com` (CNAME vers l'app). C'est l'URL encodée dans les QR codes : elle doit rester stable tant que des codes sont imprimés.

L'API Admin utilisée par l'app est `2026-04` (`app/shopify.server.ts`), la plus récente gérée par `@shopify/shopify-api` 12.3.
