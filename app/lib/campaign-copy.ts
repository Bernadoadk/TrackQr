/**
 * Interface text of the public campaign pages (default button labels,
 * consent line, form errors, countdown units…) in the visitor's language.
 * The merchant's own content is shown as written. Kept small and separate
 * from the admin dictionary so public pages stay light.
 *
 * Client-safe.
 */
import { parseAcceptLanguage } from "./routing";

export type CampaignLang = "en" | "fr" | "es" | "de" | "pt";

export interface CampaignCopy {
  getOnList: string;
  thanks: string;
  yourCode: string;
  applyShop: string;
  emailAddress: string;
  notifyMe: string;
  /** {shop} = store name */
  consent: string;
  privacyPolicy: string;
  previewForm: string;
  invalidEmail: string;
  tooMany: string;
  inactive: string;
  genericError: string;
  days: string;
  hours: string;
  min: string;
  sec: string;
  shopCollection: string;
  shopSelected: string;
  poweredBy: string;
  website: string;
  previewBanner: string;
  emptyPage: string;
}

export const CAMPAIGN_COPY: Record<CampaignLang, CampaignCopy> = {
  en: {
    getOnList: "Get on the list",
    thanks: "Thanks, you're on the list.",
    yourCode: "Your code",
    applyShop: "Apply & shop →",
    emailAddress: "Email address",
    notifyMe: "Notify me",
    consent: "I agree to receive emails from {shop}. I can unsubscribe at any time.",
    privacyPolicy: "Privacy policy",
    previewForm: "Preview mode — the form is disabled.",
    invalidEmail: "Please enter a valid email address.",
    tooMany: "Too many attempts — please try again in a few minutes.",
    inactive: "This campaign is no longer accepting sign-ups.",
    genericError: "Something went wrong — please try again.",
    days: "Days",
    hours: "Hours",
    min: "Min",
    sec: "Sec",
    shopCollection: "Shop collection",
    shopSelected: "Shop selected",
    poweredBy: "Powered by",
    website: "Website",
    previewBanner: "Preview mode",
    emptyPage: "This campaign has no blocks yet.",
  },
  fr: {
    getOnList: "Inscrivez-vous",
    thanks: "Merci, vous êtes inscrit.",
    yourCode: "Votre code",
    applyShop: "Appliquer et acheter →",
    emailAddress: "Adresse e-mail",
    notifyMe: "Me prévenir",
    consent: "J'accepte de recevoir des e-mails de {shop}. Je peux me désinscrire à tout moment.",
    privacyPolicy: "Politique de confidentialité",
    previewForm: "Mode aperçu — le formulaire est désactivé.",
    invalidEmail: "Veuillez saisir une adresse e-mail valide.",
    tooMany: "Trop de tentatives — réessayez dans quelques minutes.",
    inactive: "Cette campagne n'accepte plus d'inscriptions.",
    genericError: "Une erreur s'est produite — veuillez réessayer.",
    days: "Jours",
    hours: "Heures",
    min: "Min",
    sec: "Sec",
    shopCollection: "Voir la collection",
    shopSelected: "Voir la sélection",
    poweredBy: "Propulsé par",
    website: "Site web",
    previewBanner: "Mode aperçu",
    emptyPage: "Cette campagne n'a pas encore de blocs.",
  },
  es: {
    getOnList: "Apúntate",
    thanks: "Gracias, ya estás en la lista.",
    yourCode: "Tu código",
    applyShop: "Aplicar y comprar →",
    emailAddress: "Correo electrónico",
    notifyMe: "Avísame",
    consent: "Acepto recibir correos de {shop}. Puedo darme de baja en cualquier momento.",
    privacyPolicy: "Política de privacidad",
    previewForm: "Modo de vista previa — el formulario está desactivado.",
    invalidEmail: "Introduce un correo electrónico válido.",
    tooMany: "Demasiados intentos — inténtalo de nuevo en unos minutos.",
    inactive: "Esta campaña ya no acepta registros.",
    genericError: "Algo salió mal — inténtalo de nuevo.",
    days: "Días",
    hours: "Horas",
    min: "Min",
    sec: "Seg",
    shopCollection: "Ver la colección",
    shopSelected: "Ver la selección",
    poweredBy: "Con la tecnología de",
    website: "Sitio web",
    previewBanner: "Vista previa",
    emptyPage: "Esta campaña aún no tiene bloques.",
  },
  de: {
    getOnList: "Jetzt eintragen",
    thanks: "Danke, du stehst auf der Liste.",
    yourCode: "Dein Code",
    applyShop: "Einlösen & einkaufen →",
    emailAddress: "E-Mail-Adresse",
    notifyMe: "Benachrichtige mich",
    consent: "Ich möchte E-Mails von {shop} erhalten. Ich kann mich jederzeit abmelden.",
    privacyPolicy: "Datenschutzerklärung",
    previewForm: "Vorschaumodus — das Formular ist deaktiviert.",
    invalidEmail: "Bitte gib eine gültige E-Mail-Adresse ein.",
    tooMany: "Zu viele Versuche — bitte versuche es in ein paar Minuten erneut.",
    inactive: "Diese Kampagne nimmt keine Anmeldungen mehr an.",
    genericError: "Etwas ist schiefgelaufen — bitte versuche es erneut.",
    days: "Tage",
    hours: "Std",
    min: "Min",
    sec: "Sek",
    shopCollection: "Zur Kollektion",
    shopSelected: "Zur Auswahl",
    poweredBy: "Bereitgestellt von",
    website: "Webseite",
    previewBanner: "Vorschau",
    emptyPage: "Diese Kampagne hat noch keine Blöcke.",
  },
  pt: {
    getOnList: "Entre na lista",
    thanks: "Obrigado, você está na lista.",
    yourCode: "Seu código",
    applyShop: "Aplicar e comprar →",
    emailAddress: "Endereço de e-mail",
    notifyMe: "Avise-me",
    consent: "Aceito receber e-mails de {shop}. Posso cancelar a inscrição a qualquer momento.",
    privacyPolicy: "Política de privacidade",
    previewForm: "Modo de pré-visualização — o formulário está desativado.",
    invalidEmail: "Insira um endereço de e-mail válido.",
    tooMany: "Muitas tentativas — tente novamente em alguns minutos.",
    inactive: "Esta campanha não aceita mais inscrições.",
    genericError: "Algo deu errado — tente novamente.",
    days: "Dias",
    hours: "Horas",
    min: "Min",
    sec: "Seg",
    shopCollection: "Ver a coleção",
    shopSelected: "Ver a seleção",
    poweredBy: "Com tecnologia",
    website: "Site",
    previewBanner: "Pré-visualização",
    emptyPage: "Esta campanha ainda não tem blocos.",
  },
};

export function isCampaignLang(value: unknown): value is CampaignLang {
  return typeof value === "string" && value in CAMPAIGN_COPY;
}

/** First supported language of the visitor's browser, English otherwise. */
export function pickCampaignLang(acceptLanguage: string | null | undefined): CampaignLang {
  return parseAcceptLanguage(acceptLanguage).find(isCampaignLang) ?? "en";
}
