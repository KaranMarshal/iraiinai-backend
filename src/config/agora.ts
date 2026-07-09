import { ENV } from './env';

export const AGORA_CONFIG = {
  appId: ENV.AGORA_APP_ID,
  appCertificate: ENV.AGORA_APP_CERTIFICATE,
  // Token expiry in seconds (1 hour)
  tokenExpirySeconds: 3600,
};

export const isAgoraConfigured = (): boolean =>
  Boolean(AGORA_CONFIG.appId && AGORA_CONFIG.appCertificate);
