// Imported first by main.tsx: the stores read local storage as they are
// created, which is while the router's imports are evaluated.
import { migrateLegacyStorage } from './lib/migrate-legacy-storage';

migrateLegacyStorage();
