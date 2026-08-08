export function normalizeTokens(tokens = []) {
  if (!Array.isArray(tokens)) {
    return [];
  }

  return Array.from(
    new Set(
      tokens
        .map((token) => {
          if (typeof token === 'string') {
            return token.trim();
          }
          if (token && typeof token === 'object') {
            return [token.token, token.fcmToken, token.value].find((value) => typeof value === 'string' && value.trim()) || '';
          }
          return '';
        })
        .filter(Boolean)
    )
  );
}

export function collectRecipientTokens({ tokenDocs = [], currentToken = '', fallbackTokens = [] } = {}) {
  const tokens = [];

  if (Array.isArray(tokenDocs)) {
    tokens.push(...tokenDocs.map((entry) => entry?.token || entry?.fcmToken || entry?.value));
  }

  if (typeof currentToken === 'string' && currentToken.trim()) {
    tokens.push(currentToken.trim());
  }

  if (Array.isArray(fallbackTokens)) {
    tokens.push(...fallbackTokens);
  }

  return normalizeTokens(tokens);
}

export function groupRecipientTokensBySource({
  tokenDocs = [],
  currentToken = '',
  currentDeviceType = 'web',
  fallbackTokens = []
} = {}) {
  const webTokens = [];
  const androidTokens = [];

  const addToken = (token, source) => {
    if (typeof token !== 'string') return;
    const normalized = token.trim();
    if (!normalized) return;
    if (source === 'android') {
      androidTokens.push(normalized);
    } else {
      webTokens.push(normalized);
    }
  };

  if (Array.isArray(tokenDocs)) {
    tokenDocs.forEach((entry) => {
      const token = entry?.token || entry?.fcmToken || entry?.value;
      const source = entry?.source || entry?.platform || entry?.deviceType || '';
      if (source === 'android' || /android|native/i.test(String(source))) {
        addToken(token, 'android');
      } else {
        addToken(token, 'web');
      }
    });
  }

  if (typeof currentToken === 'string' && currentToken.trim()) {
    addToken(currentToken, currentDeviceType === 'android' ? 'android' : 'web');
  }

  if (Array.isArray(fallbackTokens)) {
    fallbackTokens.forEach((token) => addToken(token, 'android'));
  }

  return {
    web: normalizeTokens(webTokens),
    android: normalizeTokens(androidTokens)
  };
}
