// Public OAuth client for the hosted app. The app owner fills this once; end users
// only see "Sign in with Google". These are public identifiers, never secrets.
//
// Owner setup (once): Google Cloud → enable Drive API → OAuth consent screen
// (External; add test users while unverified) → Web OAuth client with the Pages
// origin and http://localhost:8770 → paste the client ID here. API key is only
// needed if you switch the default mode to "picker".
export const DRIVE_DEFAULTS = {
  clientId: "",
  apiKey: "",
  mode: "full", // "full" = automatic folder, "picker" = least access
  folderName: "TubeShelf Backups",
  autoSave: true,
};

export const HAS_DRIVE_DEFAULTS = Boolean(DRIVE_DEFAULTS.clientId.trim());
